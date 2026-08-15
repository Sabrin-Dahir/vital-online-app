import 'package:flutter/material.dart';
import '../../utils/field_validation.dart';
import '../../utils/password_utils.dart';
import '../../services/api_service.dart';
import '../../widgets/scrollable_body.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import 'register_screen.dart';
import 'coach_register_screen.dart';
import 'forgot_password_screen.dart';
import 'auth_home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;
  String? _errorMessage;

  final _apiService = ApiService();

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final user = await _apiService.login(
        PasswordUtils.normalizeEmail(_emailController.text),
        _passwordController.text,
      );

      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (context) => AuthHome(user: user),
          ),
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = ApiService.friendlyError(e);
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      body: Stack(
        children: [
          // Brand atmosphere (matches web login)
          Container(
            decoration: const BoxDecoration(
              gradient: CoachDashboardTheme.headerGradient,
            ),
          ),
          Positioned(
            top: -80,
            left: -60,
            child: _GlowOrb(
              size: 220,
              color: CoachDashboardTheme.primaryLight.withValues(alpha: 0.35),
            ),
          ),
          Positioned(
            bottom: -100,
            right: -40,
            child: _GlowOrb(
              size: 260,
              color: const Color(0xFF2E3A6B).withValues(alpha: 0.55),
            ),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                physics: dashboardScrollPhysics,
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 360),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Brand header above card
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white.withValues(alpha: 0.25)),
                        ),
                        child: const Icon(
                          Icons.fitness_center_rounded,
                          size: 28,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 14),
                      const Text(
                        'Vital Fitness',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Sign in to your workspace',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: Colors.white.withValues(alpha: 0.75),
                        ),
                      ),
                      const SizedBox(height: 22),

                      // Compact form card
                      Hero(
                        tag: 'auth_card',
                        child: Material(
                          color: Colors.transparent,
                          child: Container(
                            padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
                            decoration: BoxDecoration(
                              color: isDark
                                  ? const Color(0xFF181B24).withValues(alpha: 0.96)
                                  : Colors.white.withValues(alpha: 0.97),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: isDark
                                    ? const Color(0xFF2A2F3D)
                                    : Colors.white.withValues(alpha: 0.55),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.22),
                                  blurRadius: 32,
                                  offset: const Offset(0, 14),
                                ),
                              ],
                            ),
                            child: Form(
                              key: _formKey,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    'Welcome back',
                                    style: TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.w700,
                                      color: isDark
                                          ? Colors.white
                                          : CoachDashboardTheme.textPrimary,
                                      letterSpacing: -0.2,
                                    ),
                                  ),
                                  const SizedBox(height: 18),

                                  if (_errorMessage != null) ...[
                                    _AlertBanner(
                                      message: _errorMessage!,
                                      color: CoachDashboardTheme.danger,
                                    ),
                                    const SizedBox(height: 14),
                                  ],

                                  TextFormField(
                                    controller: _emailController,
                                    keyboardType: TextInputType.emailAddress,
                                    textInputAction: TextInputAction.next,
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: isDark
                                          ? Colors.white
                                          : CoachDashboardTheme.textPrimary,
                                    ),
                                    decoration: _inputDecoration(
                                      isDark: isDark,
                                      label: 'Email',
                                      prefixIcon: Icons.email_outlined,
                                    ),
                                    validator: validateEmail,
                                    autovalidateMode: AutovalidateMode.onUserInteraction,
                                  ),
                                  const SizedBox(height: 12),

                                  TextFormField(
                                    controller: _passwordController,
                                    obscureText: _obscurePassword,
                                    textInputAction: TextInputAction.done,
                                    onFieldSubmitted: (_) {
                                      if (!_isLoading) _handleLogin();
                                    },
                                    style: TextStyle(
                                      fontSize: 14,
                                      color: isDark
                                          ? Colors.white
                                          : CoachDashboardTheme.textPrimary,
                                    ),
                                    decoration: _inputDecoration(
                                      isDark: isDark,
                                      label: 'Password',
                                      prefixIcon: Icons.lock_outline,
                                    ).copyWith(
                                      suffixIcon: IconButton(
                                        icon: Icon(
                                          _obscurePassword
                                              ? Icons.visibility_outlined
                                              : Icons.visibility_off_outlined,
                                          size: 20,
                                          color: isDark
                                              ? Colors.white54
                                              : CoachDashboardTheme.textSecondary,
                                        ),
                                        onPressed: () => setState(
                                          () => _obscurePassword = !_obscurePassword,
                                        ),
                                      ),
                                    ),
                                    validator: PasswordUtils.validateLoginPassword,
                                  ),
                                  const SizedBox(height: 18),

                                  SizedBox(
                                    height: 46,
                                    child: ElevatedButton(
                                      onPressed: _isLoading ? null : _handleLogin,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: CoachDashboardTheme.primary,
                                        foregroundColor: Colors.white,
                                        disabledBackgroundColor: CoachDashboardTheme
                                            .primary
                                            .withValues(alpha: 0.55),
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                      ),
                                      child: const Text(
                                              'Sign In',
                                              style: TextStyle(
                                                fontSize: 15,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                    ),
                                  ),
                                  const SizedBox(height: 4),

                                  TextButton(
                                    onPressed: () {
                                      Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (context) => ForgotPasswordScreen(
                                            initialEmail:
                                                _emailController.text.trim().isEmpty
                                                    ? null
                                                    : _emailController.text.trim(),
                                          ),
                                        ),
                                      );
                                    },
                                    style: TextButton.styleFrom(
                                      foregroundColor: CoachDashboardTheme.primary,
                                      padding: const EdgeInsets.symmetric(vertical: 8),
                                    ),
                                    child: const Text(
                                      'Forgot password?',
                                      style: TextStyle(
                                        fontSize: 13,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),

                                  Divider(
                                    height: 28,
                                    color: isDark
                                        ? const Color(0xFF2A2F3D)
                                        : const Color(0xFFE5E7EB),
                                  ),

                                  Wrap(
                                    alignment: WrapAlignment.center,
                                    crossAxisAlignment: WrapCrossAlignment.center,
                                    children: [
                                      Text(
                                        'New client? ',
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: isDark
                                              ? Colors.white60
                                              : CoachDashboardTheme.textSecondary,
                                        ),
                                      ),
                                      GestureDetector(
                                        onTap: () {
                                          Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (context) =>
                                                  const RegisterScreen(),
                                            ),
                                          );
                                        },
                                        child: const Text(
                                          'Create client account',
                                          style: TextStyle(
                                            fontSize: 13,
                                            color: CoachDashboardTheme.primary,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 12),

                                  OutlinedButton.icon(
                                    onPressed: () {
                                      Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (context) =>
                                              const CoachRegisterScreen(),
                                        ),
                                      );
                                    },
                                    icon: const Icon(Icons.school_outlined, size: 18),
                                    label: const Text('Register as a Coach'),
                                    style: OutlinedButton.styleFrom(
                                      foregroundColor: isDark
                                          ? Colors.white70
                                          : CoachDashboardTheme.primary,
                                      side: BorderSide(
                                        color: isDark
                                            ? const Color(0xFF2A2F3D)
                                            : const Color(0xFFE5E7EB),
                                      ),
                                      padding: const EdgeInsets.symmetric(vertical: 12),
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(12),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    'Clients browse coaches and send requests. Coaches need admin approval.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      fontSize: 11,
                                      height: 1.35,
                                      color: isDark
                                          ? Colors.white38
                                          : CoachDashboardTheme.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
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
        ],
      ),
    );
  }

  InputDecoration _inputDecoration({
    required bool isDark,
    required String label,
    required IconData prefixIcon,
  }) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide(
        color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB),
      ),
    );
    return InputDecoration(
      labelText: label,
      floatingLabelBehavior: FloatingLabelBehavior.auto,
      labelStyle: TextStyle(
        fontSize: 13,
        color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
      ),
      prefixIcon: Icon(
        prefixIcon,
        size: 18,
        color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: border,
      enabledBorder: border,
      focusedBorder: border.copyWith(
        borderSide: const BorderSide(color: CoachDashboardTheme.primary, width: 1.5),
      ),
      errorBorder: border.copyWith(
        borderSide: const BorderSide(color: CoachDashboardTheme.danger),
      ),
      focusedErrorBorder: border.copyWith(
        borderSide: const BorderSide(color: CoachDashboardTheme.danger, width: 1.5),
      ),
      filled: true,
      fillColor: isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB),
      isDense: true,
    );
  }
}

class _GlowOrb extends StatelessWidget {
  const _GlowOrb({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [color, color.withValues(alpha: 0)],
          ),
        ),
      ),
    );
  }
}

class _AlertBanner extends StatelessWidget {
  const _AlertBanner({required this.message, required this.color});

  final String message;
  final Color color;

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
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline_rounded, size: 16, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w500,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
