import 'package:flutter/material.dart';
import '../../utils/field_validation.dart';
import '../../utils/password_utils.dart';
import '../../services/api_service.dart';
import '../../widgets/scrollable_body.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';

class ForgotPasswordScreen extends StatefulWidget {
  final String? initialEmail;

  const ForgotPasswordScreen({super.key, this.initialEmail});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _emailFormKey = GlobalKey<FormState>();
  final _resetFormKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();

  final _api = ApiService();

  bool _codeSent = false;
  bool _isLoading = false;
  bool _obscurePassword = true;
  String? _errorMessage;
  String? _infoMessage;

  @override
  void initState() {
    super.initState();
    if (widget.initialEmail != null) {
      _emailController.text = widget.initialEmail!;
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    if (!_emailFormKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _infoMessage = null;
    });
    try {
      final message = await _api.forgotPassword(_emailController.text);
      if (mounted) {
        setState(() {
          _codeSent = true;
          _infoMessage = message;
        });
      }
    } catch (e) {
      setState(() => _errorMessage = ApiService.friendlyError(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _resetPassword() async {
    if (!_resetFormKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final message = await _api.resetPassword(
        email: _emailController.text,
        code: _codeController.text,
        newPassword: _passwordController.text,
      );
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message), backgroundColor: CoachDashboardTheme.success),
        );
      }
    } catch (e) {
      setState(() => _errorMessage = ApiService.friendlyError(e));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
        title: const Text('Reset Password'),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            physics: dashboardScrollPhysics,
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16),
            child: Container(
              padding: const EdgeInsets.all(28.0),
              decoration: CoachDashboardTheme.cardDecoration(isDark),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: const BoxDecoration(
                      gradient: CoachDashboardTheme.headerGradient,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.lock_reset_rounded, size: 40, color: Colors.white),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _codeSent ? 'Enter reset code' : 'Forgot your password?',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _codeSent
                        ? 'We sent a 6-digit code to your email. Enter it below with your new password.'
                        : 'Enter your account email and we\'ll send you a reset code.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 24),

                  if (_infoMessage != null) ...[
                    _banner(_infoMessage!, CoachDashboardTheme.success),
                    const SizedBox(height: 16),
                  ],
                  if (_errorMessage != null) ...[
                    _banner(_errorMessage!, CoachDashboardTheme.danger),
                    const SizedBox(height: 16),
                  ],

                  if (!_codeSent) _buildRequestForm(isDark) else _buildResetForm(isDark),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRequestForm(bool isDark) {
    return Form(
      key: _emailFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
            decoration: CoachDashboardTheme.fieldDecoration(
              isDark: isDark,
              label: 'Email Address',
              prefixIcon: Icons.email_outlined,
            ),
            validator: validateEmail,
            autovalidateMode: AutovalidateMode.onUserInteraction,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _isLoading ? null : _sendCode,
            style: CoachDashboardTheme.primaryButtonStyle().copyWith(
              padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(vertical: 16)),
            ),
            child: const Text('Send reset code', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildResetForm(bool isDark) {
    return Form(
      key: _resetFormKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            controller: _codeController,
            keyboardType: TextInputType.number,
            style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
            decoration: CoachDashboardTheme.fieldDecoration(
              isDark: isDark,
              label: '6-digit code',
              prefixIcon: Icons.pin_outlined,
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) return 'Enter the code from your email';
              if (value.trim().length != 6) return 'The code is 6 digits';
              return null;
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _passwordController,
            obscureText: _obscurePassword,
            style: TextStyle(color: isDark ? Colors.white : CoachDashboardTheme.textPrimary),
            decoration: CoachDashboardTheme.fieldDecoration(
              isDark: isDark,
              label: 'New password',
              prefixIcon: Icons.lock_outline,
            ).copyWith(
              suffixIcon: IconButton(
                icon: Icon(
                  _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                ),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
            validator: PasswordUtils.validatePassword,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _isLoading ? null : _resetPassword,
            style: CoachDashboardTheme.primaryButtonStyle().copyWith(
              padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(vertical: 16)),
            ),
            child: const Text('Reset password', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: _isLoading ? null : _sendCode,
            child: const Text('Resend code'),
          ),
        ],
      ),
    );
  }

  Widget _banner(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(color: color, fontWeight: FontWeight.w500),
      ),
    );
  }
}
