import 'package:flutter/material.dart';
import '../../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import '../../../services/api_service.dart';
import '../../../utils/password_utils.dart';

class AdminSummaryStat {
  final String label;
  final String value;
  final Color color;
  final IconData icon;

  const AdminSummaryStat({
    required this.label,
    required this.value,
    required this.color,
    required this.icon,
  });
}

class AdminSummaryRow extends StatelessWidget {
  final List<AdminSummaryStat> stats;
  final bool isDark;

  const AdminSummaryRow({super.key, required this.stats, required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: stats
          .map(
            (stat) => Expanded(
              child: Container(
                margin: EdgeInsets.only(right: stat == stats.last ? 0 : 8),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
                decoration: CoachDashboardTheme.cardDecoration(isDark),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(stat.icon, size: 16, color: stat.color),
                    const SizedBox(height: 6),
                    Text(
                      stat.value,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                      ),
                    ),
                    Text(
                      stat.label,
                      style: TextStyle(
                        fontSize: 11,
                        color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          )
          .toList(),
    );
  }
}

class AdminFilterChips extends StatelessWidget {
  final List<String> labels;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final bool isDark;

  const AdminFilterChips({
    super.key,
    required this.labels,
    required this.selectedIndex,
    required this.onSelected,
    this.isDark = false,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: List.generate(labels.length, (index) {
          final selected = selectedIndex == index;
          return Padding(
            padding: EdgeInsets.only(right: index == labels.length - 1 ? 0 : 8),
            child: FilterChip(
              label: Text(labels[index]),
              selected: selected,
              onSelected: (_) => onSelected(index),
              selectedColor: CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.25 : 0.12),
              checkmarkColor: CoachDashboardTheme.primary,
              labelStyle: TextStyle(
                fontSize: 12,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected
                    ? CoachDashboardTheme.primary
                    : (isDark ? Colors.white70 : CoachDashboardTheme.textSecondary),
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(
                  color: selected
                      ? CoachDashboardTheme.primary.withValues(alpha: 0.4)
                      : (isDark ? Colors.white24 : Colors.grey.withValues(alpha: 0.3)),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class AdminEmptyState extends StatelessWidget {
  final bool isDark;
  final IconData icon;
  final String message;
  final String? subtitle;

  const AdminEmptyState({
    super.key,
    required this.isDark,
    required this.icon,
    required this.message,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: isDark ? Colors.white24 : Colors.black26),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 16,
                color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 320),
                child: Text(
                  subtitle!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.4,
                    color: isDark ? Colors.white54 : Colors.grey,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class AdminStatusBadge extends StatelessWidget {
  final String label;
  final Color color;

  const AdminStatusBadge({super.key, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}

String formatAdminDate(dynamic value) {
  if (value == null) return '';
  final date = DateTime.tryParse(value.toString());
  if (date == null) return value.toString();
  return '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
}

class AdminDetailSection extends StatelessWidget {
  final bool isDark;
  final String title;
  final List<Widget> children;

  const AdminDetailSection({
    super.key,
    required this.isDark,
    required this.title,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    final visible = children.where((c) => c is! SizedBox).toList();
    if (visible.isEmpty) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 12),
          ...visible,
        ],
      ),
    );
  }
}

class AdminDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isDark;

  const AdminDetailRow({
    super.key,
    required this.label,
    required this.value,
    this.isDark = false,
  });

  @override
  Widget build(BuildContext context) {
    if (value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: isDark ? Colors.white38 : CoachDashboardTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              height: 1.45,
              color: isDark ? Colors.white.withValues(alpha: 0.9) : CoachDashboardTheme.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

Future<Map<String, dynamic>?> showAdminRegisterAccountDialog({
  required BuildContext context,
  required Future<Map<String, dynamic>> Function({
    required String name,
    required String email,
    required String password,
    String role,
  }) createAccount,
  required String role,
}) {
  return showDialog<Map<String, dynamic>>(
    context: context,
    builder: (ctx) => _AdminRegisterAccountDialog(
      createAccount: createAccount,
      role: role,
    ),
  );
}

class _AdminRegisterAccountDialog extends StatefulWidget {
  final Future<Map<String, dynamic>> Function({
    required String name,
    required String email,
    required String password,
    String role,
  }) createAccount;
  final String role;

  const _AdminRegisterAccountDialog({
    required this.createAccount,
    required this.role,
  });

  @override
  State<_AdminRegisterAccountDialog> createState() => _AdminRegisterAccountDialogState();
}

class _AdminRegisterAccountDialogState extends State<_AdminRegisterAccountDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _saving = false;
  String? _error;

  bool get _isCoach => widget.role == 'coach';

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false) || _saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await widget.createAccount(
        name: _name.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        role: widget.role,
      );
      if (!mounted) return;
      Navigator.pop(context, result);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = ApiService.friendlyError(e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isCoach ? 'Register coach' : 'Register client'),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _isCoach
                    ? 'Creates an approved coach. They can sign in with this password.'
                    : 'Creates a client account. They can sign in with this password.',
                style: const TextStyle(fontSize: 13),
              ),
              if (_error != null) ...[
                const SizedBox(height: 10),
                Text(_error!, style: const TextStyle(color: CoachDashboardTheme.danger, fontSize: 13)),
              ],
              const SizedBox(height: 12),
              TextFormField(
                controller: _name,
                decoration: const InputDecoration(labelText: 'Full name'),
                textCapitalization: TextCapitalization.words,
                validator: (value) =>
                    (value == null || value.trim().isEmpty) ? 'Full name is required' : null,
              ),
              TextFormField(
                controller: _email,
                decoration: const InputDecoration(labelText: 'Email'),
                keyboardType: TextInputType.emailAddress,
                validator: (value) =>
                    (value == null || value.trim().isEmpty) ? 'Email is required' : null,
              ),
              TextFormField(
                controller: _password,
                decoration: const InputDecoration(labelText: 'Password'),
                obscureText: true,
                validator: PasswordUtils.validatePassword,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: _saving ? null : _submit,
          child: Text(_saving ? 'Creating…' : (_isCoach ? 'Create coach' : 'Create client')),
        ),
      ],
    );
  }
}

