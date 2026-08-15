import 'package:flutter/material.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../utils/somalia_regions.dart';
import '../../../widgets/language_picker_sheet.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/profile_avatar.dart';
import '../../../widgets/certificate_files_gallery.dart';
import '../../../widgets/account/change_password_dialog.dart';
import '../../support/help_support_screen.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../../../../main.dart';

class CoachSettingsTab extends StatefulWidget {
  final User coach;
  final VoidCallback onLogout;
  final ValueChanged<User>? onCoachUpdated;

  const CoachSettingsTab({
    super.key,
    required this.coach,
    required this.onLogout,
    this.onCoachUpdated,
  });

  @override
  State<CoachSettingsTab> createState() => _CoachSettingsTabState();
}

class _CoachSettingsTabState extends State<CoachSettingsTab> {
  final ApiService _api = ApiService();
  final _bioController = TextEditingController();
  final _experienceController = TextEditingController();
  final _specializationController = TextEditingController();
  final _phoneController = TextEditingController();
  final _certificationsController = TextEditingController();
  bool _isSaving = false;
  bool _isLoading = false;
  bool _notifEnabled = true;
  bool _privProfile = false;
  String? _photoUrl;
  int? _yearsExperience;
  int? _age;
  int _appointmentDuration = 60;
  String _location = '';
  String _workingHours = '';
  List<String> _workingDays = [];
  List<String> _appointmentDays = [];
  List<dynamic> _dayAvailability = [];
  late User _coach;

  @override
  void initState() {
    super.initState();
    _coach = widget.coach;
    _hydrateFromUser(_coach);
    _refreshProfile();
  }

  @override
  void didUpdateWidget(covariant CoachSettingsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.coach.id != widget.coach.id ||
        oldWidget.coach.profile != widget.coach.profile) {
      _coach = widget.coach;
      _hydrateFromUser(_coach);
    }
  }

  void _hydrateFromUser(User coach) {
    final profile = coach.profile;
    _bioController.text = profile?.bio ?? '';
    _experienceController.text = profile?.experience ?? '';
    _specializationController.text = (profile?.specialization ?? const <String>[]).join(', ');
    _certificationsController.text = profile?.certifications.join(', ') ?? '';
    _phoneController.text = coach.phone ?? profile?.phone ?? '';
    _photoUrl = profile?.photoUrl;
    _yearsExperience = profile?.yearsExperience;
    _workingDays = List<String>.from(profile?.workingDays ?? const []);
    _appointmentDays = List<String>.from(profile?.appointmentDays ?? const []);
    _dayAvailability = List<dynamic>.from(profile?.dayAvailability ?? const []);
    _location = SomaliaRegions.match(profile?.location) ?? '';
    _age = profile?.age;
    _appointmentDuration = profile?.appointmentDurationMinutes ?? 60;
    _workingHours = [
      if ((profile?.workingHoursStart ?? '').isNotEmpty) profile!.workingHoursStart!,
      if ((profile?.workingHoursEnd ?? '').isNotEmpty) profile!.workingHoursEnd!,
    ].join(' – ');
    if (_experienceController.text.trim().isEmpty && _yearsExperience != null) {
      _experienceController.text = '$_yearsExperience years experience';
    }
  }

  Future<void> _refreshProfile() async {
    setState(() => _isLoading = true);
    try {
      final fresh = await _api.getMe();
      if (!mounted) return;
      if (fresh != null && fresh.id == widget.coach.id) {
        _coach = fresh;
        _hydrateFromUser(fresh);
        widget.onCoachUpdated?.call(fresh);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _onPhotoChanged(String? newUrl) {
    setState(() => _photoUrl = newUrl);
    final current = _coach;
    final updatedProfile = current.profile?.copyWith(photoUrl: newUrl) ??
        Profile(goals: const [], photoUrl: newUrl);
    final updated = current.copyWith(profile: updatedProfile);
    _coach = updated;
    widget.onCoachUpdated?.call(updated);
  }

  @override
  void dispose() {
    _bioController.dispose();
    _experienceController.dispose();
    _specializationController.dispose();
    _phoneController.dispose();
    _certificationsController.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    setState(() => _isSaving = true);
    try {
      final certs = _certificationsController.text
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();

      final locationError = SomaliaRegions.validate(_location);
      if (locationError != null) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(locationError), backgroundColor: CoachDashboardTheme.danger),
          );
        }
        setState(() => _isSaving = false);
        return;
      }

      final updatedProfile = await _api.updateProfile(
        bio: _bioController.text.trim(),
        experience: _experienceController.text.trim(),
        certifications: certs,
        phone: _phoneController.text.trim(),
        yearsExperience: _yearsExperience,
        location: SomaliaRegions.match(_location) ?? _location,
      );

      final updatedUser = _coach.copyWith(
        phone: _phoneController.text.trim(),
        profile: updatedProfile.copyWith(photoUrl: _photoUrl ?? updatedProfile.photoUrl),
      );
      _coach = updatedUser;
      _hydrateFromUser(updatedUser);
      widget.onCoachUpdated?.call(updatedUser);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated successfully'), backgroundColor: CoachDashboardTheme.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _confirmLogout() async {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: isDark ? const Color(0xFF181B24) : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('Sign Out', style: CoachDashboardTheme.sectionTitle(isDark)),
        content: Text(
          'Are you sure you want to sign out of your coach account?',
          style: TextStyle(color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Sign Out', style: TextStyle(color: CoachDashboardTheme.danger, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _api.clearAuth();
      widget.onLogout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final l10n = AppLocalizations.of(context);
    final localeCode = Localizations.localeOf(context).languageCode;
    final specs = _coach.profile?.specialization ?? [];

    return CoachPage(
      title: l10n.settings,
      body: ListView(
        physics: dashboardScrollPhysics,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
        children: [
          _ProfileHeader(
            coach: _coach,
            specializations: specs,
            isDark: isDark,
            photoUrl: _photoUrl,
            onPhotoChanged: _onPhotoChanged,
            phone: _phoneController.text,
            yearsExperience: _yearsExperience,
            workingDays: _workingDays,
            onRefresh: _isLoading ? null : _refreshProfile,
            isRefreshing: _isLoading,
          ),
          const SizedBox(height: 24),
          _SectionLabel('PROFILE', isDark),
          const SizedBox(height: 10),
          _ExpandableSettingsCard(
            isDark: isDark,
            title: 'Professional Details',
            subtitle: 'Visible to your clients on their coaching profile.',
            children: [
              TextField(
                controller: _phoneController,
                keyboardType: TextInputType.phone,
                style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Phone',
                  hint: 'Contact number',
                  prefixIcon: Icons.phone_outlined,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _bioController,
                maxLines: 3,
                style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Bio',
                  hint: 'Tell clients about your coaching style...',
                  prefixIcon: Icons.person_outline_rounded,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _experienceController,
                style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Experience',
                  hint: 'e.g. 8 years, NASM certified',
                  prefixIcon: Icons.workspace_premium_outlined,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _specializationController,
                readOnly: true,
                enabled: false,
                maxLines: 3,
                style: TextStyle(color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Specializations (set by Admin)',
                  hint: 'Contact admin to change',
                  prefixIcon: Icons.fitness_center_outlined,
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _certificationsController,
                style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Certifications',
                  hint: 'ACE, NASM, ...',
                  prefixIcon: Icons.verified_outlined,
                ),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                value: SomaliaRegions.contains(_location) ? _location : null,
                isExpanded: true,
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Region / Gobol *',
                  hint: 'Select Somali region',
                  prefixIcon: Icons.location_on_outlined,
                ),
                items: SomaliaRegions.all
                    .map(
                      (region) => DropdownMenuItem(
                        value: region,
                        child: Text(region, overflow: TextOverflow.ellipsis),
                      ),
                    )
                    .toList(),
                onChanged: (region) {
                  if (region == null) return;
                  setState(() => _location = region);
                },
              ),
              const SizedBox(height: 16),
              CertificateFilesGallery(
                files: _coach.profile?.certificateFiles ?? const [],
                title: 'Uploaded certificates',
                emptyLabel: 'No certificate files on your profile yet.',
              ),
              const SizedBox(height: 16),
              _readOnlyInfoGrid(isDark),
              if (_workingDays.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text('Working days', style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _workingDays
                      .map(
                        (day) => Chip(
                          label: Text(day, style: const TextStyle(fontSize: 12)),
                          backgroundColor: CoachDashboardTheme.primary.withValues(alpha: 0.1),
                          side: BorderSide.none,
                          visualDensity: VisualDensity.compact,
                        ),
                      )
                      .toList(),
                ),
              ],
              if (_appointmentDays.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text('Appointment days', style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: _appointmentDays
                      .map(
                        (day) => Chip(
                          label: Text(day, style: const TextStyle(fontSize: 12)),
                          backgroundColor: CoachDashboardTheme.accent.withValues(alpha: 0.12),
                          side: BorderSide.none,
                          visualDensity: VisualDensity.compact,
                        ),
                      )
                      .toList(),
                ),
              ],
              if (_dayAvailability.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text('Day availability', style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary)),
                const SizedBox(height: 8),
                ..._dayAvailability.map((raw) {
                  if (raw is! Map) return const SizedBox.shrink();
                  final day = raw['day']?.toString() ?? '';
                  final start = raw['start']?.toString() ?? '';
                  final end = raw['end']?.toString() ?? '';
                  if (day.isEmpty) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      '$day  $start–$end',
                      style: TextStyle(
                        fontSize: 13,
                        color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary,
                      ),
                    ),
                  );
                }),
              ],
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: CoachDashboardTheme.primaryButtonStyle(),
                  onPressed: _isSaving ? null : _saveProfile,
                  icon: _isSaving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: const SizedBox.shrink(),
                        )
                      : const Icon(Icons.save_outlined, size: 18),
                  label: Text('Save Changes'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _SectionLabel(l10n.preferences, isDark),
          const SizedBox(height: 10),
          Container(
            decoration: CoachDashboardTheme.cardDecoration(isDark),
            child: Column(
              children: [
                _SettingsSwitch(
                  icon: Icons.dark_mode_outlined,
                  title: l10n.darkMode,
                  subtitle: l10n.useDarkTheme,
                  value: isDark,
                  isDark: isDark,
                  onChanged: (val) => MyApp.of(context)?.toggleTheme(val),
                ),
                _divider(isDark),
                _SettingsAction(
                  icon: Icons.language_rounded,
                  title: l10n.language,
                  subtitle: l10n.languageLabel(localeCode),
                  isDark: isDark,
                  onTap: () => showLanguagePicker(context),
                ),
                _divider(isDark),
                _SettingsSwitch(
                  icon: Icons.notifications_outlined,
                  title: l10n.pushNotifications,
                  subtitle: l10n.pushNotificationsSubtitle,
                  value: _notifEnabled,
                  isDark: isDark,
                  onChanged: (val) => setState(() => _notifEnabled = val),
                ),
                _divider(isDark),
                _SettingsSwitch(
                  icon: Icons.visibility_off_outlined,
                  title: 'Private Profile',
                  subtitle: 'Hide profile from public listings',
                  value: _privProfile,
                  isDark: isDark,
                  onChanged: (val) => setState(() => _privProfile = val),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _SectionLabel(l10n.account, isDark),
          const SizedBox(height: 10),
          Container(
            decoration: CoachDashboardTheme.cardDecoration(isDark),
            child: Column(
              children: [
                _SettingsAction(
                  icon: Icons.lock_outline_rounded,
                  title: 'Change Password',
                  subtitle: 'Update your account password',
                  isDark: isDark,
                  onTap: () => showChangePasswordDialog(context),
                ),
                _divider(isDark),
                _SettingsAction(
                  icon: Icons.help_outline_rounded,
                  title: 'Help & Support',
                  subtitle: 'FAQs, guides, and contact',
                  isDark: isDark,
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const HelpSupportScreen()),
                    );
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _confirmLogout,
              icon: const Icon(Icons.logout_rounded, size: 18, color: CoachDashboardTheme.danger),
              label: Text(l10n.signOut, style: const TextStyle(color: CoachDashboardTheme.danger, fontWeight: FontWeight.w600)),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: BorderSide(color: CoachDashboardTheme.danger.withValues(alpha: 0.4)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _divider(bool isDark) => Divider(
        height: 1,
        indent: 56,
        color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB),
      );

  Widget _readOnlyInfoGrid(bool isDark) {
    final items = <MapEntry<String, String>>[
      if (_age != null) MapEntry('Age', '$_age'),
      if (_yearsExperience != null) MapEntry('Years experience', '$_yearsExperience'),
      if (_appointmentDuration > 0) MapEntry('Appointment duration', '$_appointmentDuration min'),
      if (_workingHours.isNotEmpty) MapEntry('Working hours', _workingHours),
    ];
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      children: items
          .map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      item.key,
                      style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                    ),
                  ),
                  Flexible(
                    child: Text(
                      item.value,
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  final bool isDark;

  const _SectionLabel(this.text, this.isDark);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Text(text, style: CoachDashboardTheme.sectionLabel(isDark)),
    );
  }
}

class _ExpandableSettingsCard extends StatelessWidget {
  final bool isDark;
  final String title;
  final String subtitle;
  final List<Widget> children;

  const _ExpandableSettingsCard({
    required this.isDark,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: false,
          tilePadding: const EdgeInsets.fromLTRB(16, 14, 12, 10),
          expandedCrossAxisAlignment: CrossAxisAlignment.start,
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          iconColor: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
          collapsedIconColor: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
          title: Text(title, style: CoachDashboardTheme.sectionTitle(isDark)),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              subtitle,
              style: TextStyle(
                fontSize: 12,
                color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
              ),
            ),
          ),
          children: children,
        ),
      ),
    );
  }
}

class _ProfileHeader extends StatelessWidget {
  final User coach;
  final List<String> specializations;
  final bool isDark;
  final String? photoUrl;
  final ValueChanged<String?> onPhotoChanged;
  final String? phone;
  final int? yearsExperience;
  final List<String> workingDays;
  final VoidCallback? onRefresh;
  final bool isRefreshing;

  const _ProfileHeader({
    required this.coach,
    required this.specializations,
    required this.isDark,
    required this.photoUrl,
    required this.onPhotoChanged,
    this.phone,
    this.yearsExperience,
    this.workingDays = const [],
    this.onRefresh,
    this.isRefreshing = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
            decoration: const BoxDecoration(gradient: CoachDashboardTheme.headerGradient),
            child: Row(
              children: [
                ProfileAvatar(
                  name: coach.name,
                  photoUrl: photoUrl,
                  radius: 28,
                  editable: true,
                  backgroundColor: CoachDashboardTheme.primary,
                  onPhotoChanged: onPhotoChanged,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        coach.name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        coach.email,
                        style: TextStyle(color: Colors.white.withValues(alpha: 0.8), fontSize: 13),
                      ),
                      if ((phone ?? '').isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          phone!,
                          style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12),
                        ),
                      ],
                    ],
                  ),
                ),
                if (onRefresh != null)
                  IconButton(
                    onPressed: onRefresh,
                    icon: isRefreshing
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: const SizedBox.shrink(),
                          )
                        : const Icon(Icons.refresh_rounded, color: Colors.white),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _badge(Icons.verified_outlined, 'Certified Coach', CoachDashboardTheme.primary, isDark),
                _badge(Icons.badge_outlined, 'Pro Account', CoachDashboardTheme.accent, isDark),
                if (yearsExperience != null)
                  _badge(Icons.timeline, '$yearsExperience yrs exp', CoachDashboardTheme.success, isDark),
              ],
            ),
          ),
          if (specializations.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: specializations
                    .map(
                      (s) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(
                          color: CoachDashboardTheme.primary.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: CoachDashboardTheme.primary.withValues(alpha: 0.15)),
                        ),
                        child: Text(
                          s,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: CoachDashboardTheme.primary,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
        ],
      ),
    );
  }

  Widget _badge(IconData icon, String label, Color color, bool isDark) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: isDark ? 0.15 : 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
        ],
      ),
    );
  }
}

class _SettingsSwitch extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final bool isDark;
  final ValueChanged<bool> onChanged;

  const _SettingsSwitch({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.isDark,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          _iconBox(icon, isDark),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                ),
              ],
            ),
          ),
          Switch(
            value: value,
            onChanged: onChanged,
            activeThumbColor: Colors.white,
            activeTrackColor: CoachDashboardTheme.primary,
          ),
        ],
      ),
    );
  }
}

class _SettingsAction extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool isDark;
  final VoidCallback onTap;

  const _SettingsAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: [
              _iconBox(icon, isDark),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, size: 20, color: isDark ? Colors.white24 : Colors.black26),
            ],
          ),
        ),
      ),
    );
  }
}

Widget _iconBox(IconData icon, bool isDark) {
  return Container(
    width: 40,
    height: 40,
    decoration: BoxDecoration(
      color: CoachDashboardTheme.primary.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Icon(icon, size: 20, color: CoachDashboardTheme.primary),
  );
}
