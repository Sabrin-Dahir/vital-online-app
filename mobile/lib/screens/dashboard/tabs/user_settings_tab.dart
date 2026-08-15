import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../main.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../widgets/language_picker_sheet.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/profile_avatar.dart';
import '../../../widgets/account/change_password_dialog.dart';
import '../../../utils/field_validation.dart';
import '../../../widgets/silent_refresh.dart';

class UserSettingsTab extends StatefulWidget {
  final User user;
  final ValueChanged<User> onUserUpdated;
  final VoidCallback onLogout;
  final FutureOr<void> Function(bool isDark) onThemeToggle;
  final bool isDark;

  const UserSettingsTab({
    super.key,
    required this.user,
    required this.onUserUpdated,
    required this.onLogout,
    required this.onThemeToggle,
    required this.isDark,
  });

  @override
  State<UserSettingsTab> createState() => UserSettingsTabState();
}

class UserSettingsTabState extends State<UserSettingsTab> {
  final ApiService _apiService = ApiService();
  final _formKey = GlobalKey<FormState>();
  final ScrollController _scrollController = ScrollController();

  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();

  bool _isSaving = false;
  bool _isLoading = true;
  bool _profileExpanded = false;

  bool _notifWorkout = true;
  bool _notifMeal = true;
  bool _notifAppointment = true;

  String? _photoUrl;
  late User _user;

  /// Called when the Settings tab is selected so the profile header is visible.
  void scrollToTop() {
    if (!_scrollController.hasClients) return;
    _scrollController.animateTo(
      0,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  void initState() {
    super.initState();
    _user = widget.user;
    _hydrateFromUser(_user);
    _loadLocalPrefs();
    _refreshProfile();
  }

  Future<void> _loadLocalPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _notifWorkout = prefs.getBool('notif_workout_${_user.id}') ?? true;
      // Meal / appointment keys with fallbacks from older preference names.
      _notifMeal = prefs.getBool('notif_meal_${_user.id}') ??
          prefs.getBool('notif_class_${_user.id}') ??
          true;
      _notifAppointment = prefs.getBool('notif_appointment_${_user.id}') ??
          prefs.getBool('notif_coach_${_user.id}') ??
          true;
    });
  }

  Future<void> _savePrefBool(String key, bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('${key}_${_user.id}', value);
  }

  @override
  void didUpdateWidget(covariant UserSettingsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.user.id != widget.user.id ||
        oldWidget.user.profile != widget.user.profile ||
        oldWidget.user.name != widget.user.name ||
        oldWidget.user.phone != widget.user.phone) {
      _user = widget.user;
      _hydrateFromUser(_user);
    }
  }

  void _hydrateFromUser(User user) {
    _nameController.text = user.name;
    _phoneController.text = user.phone ?? user.profile?.phone ?? '';
    _photoUrl = user.profile?.photoUrl;
  }

  Future<void> _refreshProfile() async {
    setState(() => _isLoading = true);
    try {
      final fresh = await _apiService.getMe();
      if (!mounted) return;
      if (fresh != null && fresh.id == widget.user.id) {
        _user = fresh;
        _hydrateFromUser(fresh);
        widget.onUserUpdated(fresh);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiService.friendlyError(e)),
            backgroundColor: CoachDashboardTheme.danger,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _onPhotoChanged(String? newUrl) {
    setState(() => _photoUrl = newUrl);
    final updatedProfile = _user.profile?.copyWith(photoUrl: newUrl) ??
        Profile(goals: const [], photoUrl: newUrl);
    final updated = _user.copyWith(profile: updatedProfile);
    _user = updated;
    widget.onUserUpdated(updated);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) {
      setState(() => _profileExpanded = true);
      return;
    }
    setState(() => _isSaving = true);
    try {
      final name = _nameController.text.trim();
      final phone = _phoneController.text.trim();
      await _apiService.updateProfile(
        fullName: name,
        phone: phone,
      );
      // Update UI from the saved form immediately — don't wait on /auth/me.
      final updatedUser = _user.copyWith(
        name: name,
        phone: phone,
        profile: (_user.profile ?? Profile(goals: const [])).copyWith(
          photoUrl: _photoUrl,
          phone: phone,
        ),
      );
      _user = updatedUser;
      _hydrateFromUser(updatedUser);
      widget.onUserUpdated(updatedUser);
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).profileUpdated),
            backgroundColor: CoachDashboardTheme.success,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
      // Optional sync in background.
      _apiService.getMe().then((fresh) {
        if (!mounted || fresh == null || fresh.id != _user.id) return;
        setState(() {
          _user = fresh;
          _hydrateFromUser(fresh);
        });
        widget.onUserUpdated(fresh);
      });
    } catch (e) {
      if (mounted) {
        setState(() => _isSaving = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiService.friendlyError(e)),
            backgroundColor: CoachDashboardTheme.danger,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted && _isSaving) setState(() => _isSaving = false);
    }
  }

  Future<void> _confirmLogout() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again to access your account.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: CoachDashboardTheme.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok == true) widget.onLogout();
  }

  Future<void> _confirmChangePassword() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Change password'),
        content: const Text('You will be asked for your current password and a new one.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    if (ok == true && mounted) {
      await showChangePasswordDialog(context);
    }
  }

  /// Live app theme — never use the stale [widget.isDark] from tab creation.
  bool get _selectedIsDark =>
      MyApp.of(context)?.isDark ??
      (Theme.of(context).brightness == Brightness.dark);

  Future<void> _setTheme(bool dark) async {
    final app = MyApp.of(context);
    if (app != null) {
      await app.toggleTheme(dark);
    } else {
      widget.onThemeToggle(dark);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final selectedIsDark = _selectedIsDark;
    final l10n = AppLocalizations.of(context);
    final localeCode = Localizations.localeOf(context).languageCode;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: CoachDashboardTheme.coachAppBar(
        context: context,
        title: l10n.settingsAndProfile,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _isLoading ? null : _refreshProfile,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: SilentRefreshIndicator(
          onRefresh: _refreshProfile,
          child: ListView(
            controller: _scrollController,
            physics: dashboardScrollPhysics,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
            children: [
              _profileHeader(isDark),
              const SizedBox(height: 18),
              _sectionLabel(isDark, 'Profile'),
              const SizedBox(height: 8),
              _settingsCard(
                isDark,
                children: [
                  _tile(
                    icon: Icons.edit_outlined,
                    color: CoachDashboardTheme.primary,
                    title: 'Edit profile',
                    subtitle: _profileExpanded
                        ? 'Hide profile details'
                        : 'Name, photo, email & phone',
                    trailing: Icon(
                      _profileExpanded
                          ? Icons.expand_less_rounded
                          : Icons.expand_more_rounded,
                      color: isDark ? Colors.white54 : Colors.black45,
                    ),
                    onTap: () =>
                        setState(() => _profileExpanded = !_profileExpanded),
                  ),
                ],
              ),
              if (_profileExpanded) ...[
                const SizedBox(height: 10),
                _editProfileCard(isDark),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: _isSaving ? null : _saveProfile,
                  style: FilledButton.styleFrom(
                    backgroundColor: CoachDashboardTheme.primary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: _isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: const SizedBox.shrink(),
                        )
                      : Text(l10n.saveProfileChanges),
                ),
              ],
              const SizedBox(height: 18),
              _sectionLabel(isDark, 'Account'),
              const SizedBox(height: 8),
              _settingsCard(
                isDark,
                children: [
                  _tile(
                    icon: Icons.lock_outline_rounded,
                    color: CoachDashboardTheme.primary,
                    title: 'Change password',
                    subtitle: 'Update your account password',
                    onTap: _confirmChangePassword,
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _sectionLabel(isDark, 'Notifications'),
              const SizedBox(height: 8),
              _settingsCard(
                isDark,
                children: [
                  SwitchListTile(
                    secondary: const Icon(
                      Icons.fitness_center_rounded,
                      color: Color(0xFFFF6B6B),
                    ),
                    title: Text(
                      l10n.workoutReminders,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    value: _notifWorkout,
                    activeThumbColor: const Color(0xFF00D4AA),
                    onChanged: (v) {
                      setState(() => _notifWorkout = v);
                      _savePrefBool('notif_workout', v);
                    },
                  ),
                  _divider(isDark),
                  SwitchListTile(
                    secondary: const Icon(
                      Icons.restaurant_rounded,
                      color: Colors.orange,
                    ),
                    title: const Text(
                      'Meal reminders',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    value: _notifMeal,
                    activeThumbColor: const Color(0xFF00D4AA),
                    onChanged: (v) {
                      setState(() => _notifMeal = v);
                      _savePrefBool('notif_meal', v);
                    },
                  ),
                  _divider(isDark),
                  SwitchListTile(
                    secondary: const Icon(
                      Icons.event_available_rounded,
                      color: Colors.blue,
                    ),
                    title: const Text(
                      'Appointment reminders',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    value: _notifAppointment,
                    activeThumbColor: const Color(0xFF00D4AA),
                    onChanged: (v) {
                      setState(() => _notifAppointment = v);
                      _savePrefBool('notif_appointment', v);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _sectionLabel(isDark, 'Appearance'),
              const SizedBox(height: 8),
              _settingsCard(
                isDark,
                children: [
                  RadioListTile<bool>(
                    value: false,
                    groupValue: selectedIsDark,
                    onChanged: (v) {
                      if (v != null) _setTheme(v);
                    },
                    secondary: Icon(
                      Icons.light_mode_outlined,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                    title: const Text(
                      'Light Mode',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    activeColor: CoachDashboardTheme.primary,
                  ),
                  _divider(isDark),
                  RadioListTile<bool>(
                    value: true,
                    groupValue: selectedIsDark,
                    onChanged: (v) {
                      if (v != null) _setTheme(v);
                    },
                    secondary: Icon(
                      Icons.dark_mode_outlined,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                    title: const Text(
                      'Dark Mode',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    activeColor: CoachDashboardTheme.primary,
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _sectionLabel(isDark, 'App'),
              const SizedBox(height: 8),
              _settingsCard(
                isDark,
                children: [
                  _tile(
                    icon: Icons.language_rounded,
                    color: Colors.orange,
                    title: l10n.language,
                    subtitle: l10n.languageLabel(localeCode),
                    onTap: () => showLanguagePicker(context),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: _confirmLogout,
                icon: const Icon(Icons.logout_rounded),
                label: Text(
                  l10n.signOut,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFF6B6B),
                  side: const BorderSide(color: Color(0xFFFF6B6B), width: 1.5),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionLabel(bool isDark, String title) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.3,
        color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
      ),
    );
  }

  Widget _settingsCard(bool isDark, {required List<Widget> children}) {
    return Container(
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }

  Widget _divider(bool isDark) =>
      Divider(height: 1, color: isDark ? Colors.white10 : Colors.black12);

  Widget _tile({
    required IconData icon,
    required Color color,
    required String title,
    String? subtitle,
    Widget? trailing,
    VoidCallback? onTap,
    bool showChevron = true,
  }) {
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: subtitle == null ? null : Text(subtitle),
      trailing: trailing ??
          (showChevron && onTap != null
              ? const Icon(Icons.chevron_right_rounded)
              : null),
      onTap: onTap,
    );
  }

  Widget _profileHeader(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Row(
        children: [
          ProfileAvatar(
            name: _nameController.text.isNotEmpty
                ? _nameController.text
                : _user.name,
            photoUrl: _photoUrl,
            radius: 36,
            editable: true,
            onPhotoChanged: _onPhotoChanged,
            backgroundColor: CoachDashboardTheme.primary,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _nameController.text.isNotEmpty
                      ? _nameController.text
                      : _user.name,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: isDark ? Colors.white : Colors.black87,
                  ),
                ),
                const SizedBox(height: 4),
                Text(_user.email, style: CoachDashboardTheme.bodyMuted(isDark)),
                if (_phoneController.text.trim().isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    _phoneController.text,
                    style: CoachDashboardTheme.bodyMuted(isDark)
                        .copyWith(fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _editProfileCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Edit profile',
            style: CoachDashboardTheme.sectionTitle(isDark).copyWith(fontSize: 15),
          ),
          const SizedBox(height: 14),
          Center(
            child: ProfileAvatar(
              name: _nameController.text.isNotEmpty
                  ? _nameController.text
                  : _user.name,
              photoUrl: _photoUrl,
              radius: 44,
              editable: true,
              onPhotoChanged: _onPhotoChanged,
              backgroundColor: CoachDashboardTheme.primary,
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Text(
              'Tap photo to change',
              style: CoachDashboardTheme.bodyMuted(isDark).copyWith(fontSize: 12),
            ),
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _nameController,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(
              labelText: 'Name',
              prefixIcon: const Icon(Icons.person_outline_rounded),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
            validator: validateFullName,
            autovalidateMode: AutovalidateMode.onUserInteraction,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextFormField(
            initialValue: _user.email,
            readOnly: true,
            enableInteractiveSelection: true,
            decoration: InputDecoration(
              labelText: 'Email',
              helperText: 'Login email cannot be changed here',
              prefixIcon: const Icon(Icons.email_outlined),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: isDark ? const Color(0xFF0F1117) : const Color(0xFFF3F4F8),
            ),
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(
              labelText: 'Phone number',
              prefixIcon: const Icon(Icons.phone_outlined),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
            validator: (v) {
              final phone = v?.trim() ?? '';
              if (phone.isEmpty) return null;
              final digits = phone.replaceAll(RegExp(r'\D'), '');
              if (digits.length < 7 || digits.length > 15) {
                return 'Please enter a valid phone number';
              }
              return null;
            },
          ),
        ],
      ),
    );
  }
}
