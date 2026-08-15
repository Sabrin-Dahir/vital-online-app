import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../utils/field_validation.dart';
import '../../utils/coach_specialization.dart';
import '../../utils/password_utils.dart';
import '../../widgets/scrollable_body.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import 'auth_home.dart';
import 'auth_routing.dart';
import 'login_screen.dart';

/// Member (client) self-registration — same `/auth/register` API as the web.
/// After signup, routes through [AuthHome] like login (role gates + password),
/// then opens the Coaches tab (web `/member/coaches`).
/// When [adminCreating] is true, an admin fills this same form and the account
/// is created via `POST /admin/users` without signing in as the new member.
class RegisterScreen extends StatefulWidget {
  final bool adminCreating;

  const RegisterScreen({super.key, this.adminCreating = false});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _usernameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _ageController = TextEditingController();
  final _heightController = TextEditingController();
  final _weightController = TextEditingController();

  String _gender = 'Male';
  String _fitnessGoal = 'General Fitness';
  bool _obscurePassword = true;
  bool _isLoading = false;
  String? _errorMessage;
  String? _successMessage;

  final _apiService = ApiService();

  static final _fitnessGoals =
      fitnessGoals.map((g) => MapEntry(g, g)).toList();

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      if (widget.adminCreating) {
        final created = await _apiService.createAdminUser(
          name: _nameController.text.trim(),
          email: PasswordUtils.normalizeEmail(_usernameController.text),
          password: _passwordController.text,
          role: 'user',
          phone: _phoneController.text.trim(),
          gender: _gender,
          age: _ageController.text.trim().isNotEmpty
              ? int.tryParse(_ageController.text.trim())
              : null,
          heightCm: _heightController.text.trim().isNotEmpty
              ? double.tryParse(_heightController.text.trim())
              : null,
          weightKg: _weightController.text.trim().isNotEmpty
              ? double.tryParse(_weightController.text.trim())
              : null,
          fitnessGoal: _fitnessGoal,
        );
        if (!mounted) return;
        Navigator.of(context).pop(created);
        return;
      }

      final user = await _apiService.register(
        fullName: _nameController.text.trim(),
        username: PasswordUtils.normalizeEmail(_usernameController.text),
        password: _passwordController.text,
        phone: _phoneController.text.trim(),
        gender: _gender,
        age: _ageController.text.trim().isNotEmpty
            ? int.tryParse(_ageController.text.trim())
            : null,
        heightCm: _heightController.text.trim().isNotEmpty
            ? double.tryParse(_heightController.text.trim())
            : null,
        weightKg: _weightController.text.trim().isNotEmpty
            ? double.tryParse(_weightController.text.trim())
            : null,
        fitnessGoal: _fitnessGoal,
      );

      if (!mounted) return;
      setState(() {
        _successMessage =
            'Account created. Opening your dashboard so you can choose a coach…';
      });
      await Future<void>.delayed(const Duration(milliseconds: 800));
      if (!mounted) return;
      // Same path as web: establish session → member shell → coaches.
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => AuthHome(
            user: user,
            memberInitialTabIndex: AuthRouting.memberCoachesTabIndex,
          ),
        ),
        (_) => false,
      );
    } catch (e) {
      setState(() => _errorMessage = ApiService.friendlyError(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _usernameController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _ageController.dispose();
    _heightController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  InputDecoration _decoration({
    required String label,
    required IconData icon,
    required bool isDark,
    String? helper,
    Widget? suffix,
  }) {
    return InputDecoration(
      labelText: label,
      helperText: helper,
      helperMaxLines: 2,
      prefixIcon: Icon(icon, size: 20),
      suffixIcon: suffix,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(
          color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: CoachDashboardTheme.primary, width: 1.5),
      ),
      filled: true,
      fillColor: isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB),
      isDense: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final textColor = isDark ? Colors.white : CoachDashboardTheme.textPrimary;
    final muted = isDark ? Colors.white70 : CoachDashboardTheme.textSecondary;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: textColor),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            physics: dashboardScrollPhysics,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Container(
                padding: const EdgeInsets.all(22),
                decoration: CoachDashboardTheme.cardDecoration(isDark),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Create client account',
                        textAlign: TextAlign.center,
                        style: theme.textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: textColor,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'You are registering as a member. Your account role stays Member. After signup you can browse coaches and send a coaching request.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13, color: muted, height: 1.35),
                      ),
                      const SizedBox(height: 20),

                      if (_successMessage != null) ...[
                        _Banner(
                          message: _successMessage!,
                          color: CoachDashboardTheme.success,
                        ),
                        const SizedBox(height: 16),
                      ],
                      if (_errorMessage != null) ...[
                        _Banner(
                          message: _errorMessage!,
                          color: CoachDashboardTheme.danger,
                          action: (!widget.adminCreating &&
                                  (_errorMessage!.toLowerCase().contains('already') ||
                                      _errorMessage!.toLowerCase().contains('sign in')))
                              ? TextButton(
                                  onPressed: () {
                                    Navigator.of(context).pushAndRemoveUntil(
                                      MaterialPageRoute(
                                        builder: (_) => const LoginScreen(),
                                      ),
                                      (_) => false,
                                    );
                                  },
                                  child: const Text('Go to Sign In'),
                                )
                              : null,
                        ),
                        const SizedBox(height: 16),
                      ],

                      TextFormField(
                        controller: _nameController,
                        textCapitalization: TextCapitalization.words,
                        decoration: _decoration(
                          label: 'Full name',
                          icon: Icons.person_outline,
                          isDark: isDark,
                        ),
                        validator: validateFullName,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                      ),
                      const SizedBox(height: 12),

                      TextFormField(
                        controller: _usernameController,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        enableSuggestions: !widget.adminCreating,
                        autofillHints: widget.adminCreating
                            ? const []
                            : const [AutofillHints.email],
                        decoration: _decoration(
                          label: 'Email',
                          icon: Icons.email_outlined,
                          isDark: isDark,
                          helper: 'Used to sign in to your account.',
                        ),
                        validator: validateEmail,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                      ),
                      const SizedBox(height: 12),

                      TextFormField(
                        controller: _phoneController,
                        keyboardType: TextInputType.phone,
                        decoration: _decoration(
                          label: 'Phone',
                          icon: Icons.phone_outlined,
                          isDark: isDark,
                        ),
                        validator: (value) {
                          final phone = value?.trim() ?? '';
                          if (phone.isEmpty) return null;
                          final digits = phone.replaceAll(RegExp(r'\D'), '');
                          if (digits.length < 7 || digits.length > 15) {
                            return 'Please enter a valid phone number';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),

                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        enableSuggestions: false,
                        autofillHints: widget.adminCreating
                            ? const []
                            : const [AutofillHints.newPassword],
                        decoration: _decoration(
                          label: 'Password',
                          icon: Icons.lock_outline,
                          isDark: isDark,
                          suffix: IconButton(
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () =>
                                setState(() => _obscurePassword = !_obscurePassword),
                          ),
                        ),
                        validator: PasswordUtils.validatePassword,
                      ),
                      const SizedBox(height: 16),

                      Text('Gender', style: TextStyle(fontWeight: FontWeight.w600, color: textColor)),
                      const SizedBox(height: 8),
                      Row(
                        children: ['Male', 'Female'].map((g) {
                          final selected = _gender == g;
                          return Expanded(
                            child: Padding(
                              padding: EdgeInsets.only(right: g == 'Male' ? 8 : 0),
                              child: OutlinedButton(
                                onPressed: () => setState(() => _gender = g),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: selected
                                      ? Colors.white
                                      : textColor,
                                  backgroundColor: selected
                                      ? CoachDashboardTheme.primary
                                      : Colors.transparent,
                                  side: BorderSide(
                                    color: selected
                                        ? CoachDashboardTheme.primary
                                        : (isDark
                                            ? const Color(0xFF2A2F3D)
                                            : const Color(0xFFE5E7EB)),
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                                child: Text(g),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 12),

                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: _ageController,
                              keyboardType: TextInputType.number,
                              decoration: _decoration(
                                label: 'Age',
                                icon: Icons.cake_outlined,
                                isDark: isDark,
                              ),
                              validator: validateAge,
                              autovalidateMode: AutovalidateMode.onUserInteraction,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextFormField(
                              controller: _heightController,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: _decoration(
                                label: 'Height (cm)',
                                icon: Icons.height,
                                isDark: isDark,
                              ),
                              validator: validateHeight,
                              autovalidateMode: AutovalidateMode.onUserInteraction,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      TextFormField(
                        controller: _weightController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: _decoration(
                          label: 'Weight (kg)',
                          icon: Icons.monitor_weight_outlined,
                          isDark: isDark,
                        ),
                        validator: validateWeight,
                        autovalidateMode: AutovalidateMode.onUserInteraction,
                      ),
                      const SizedBox(height: 12),

                      DropdownButtonFormField<String>(
                        value: _fitnessGoal,
                        decoration: _decoration(
                          label: 'Fitness goal',
                          icon: Icons.flag_outlined,
                          isDark: isDark,
                        ),
                        items: _fitnessGoals
                            .map(
                              (e) => DropdownMenuItem(
                                value: e.key,
                                child: Text(e.value),
                              ),
                            )
                            .toList(),
                        onChanged: (v) {
                          if (v != null) setState(() => _fitnessGoal = v);
                        },
                      ),
                      const SizedBox(height: 16),

                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: CoachDashboardTheme.primary.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: CoachDashboardTheme.primary.withValues(alpha: 0.2),
                          ),
                        ),
                        child: Text(
                          'After you register, you can browse the available coaches and choose the coach you want.',
                          style: TextStyle(fontSize: 12.5, height: 1.4, color: muted),
                        ),
                      ),
                      const SizedBox(height: 18),

                      SizedBox(
                        height: 48,
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _handleRegister,
                          style: CoachDashboardTheme.primaryButtonStyle().copyWith(
                            shape: WidgetStatePropertyAll(
                              RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                          ),
                          child: const Text(
                                  'Create account',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message, required this.color, this.action});

  final String message;
  final Color color;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Column(
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(color: color, fontWeight: FontWeight.w500, fontSize: 13),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}
