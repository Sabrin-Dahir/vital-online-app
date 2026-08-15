import 'package:flutter/material.dart';
import '../../models/user_model.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import 'auth_routing.dart';
import 'login_screen.dart';

/// Resolves the correct home for a signed-in user (client / coach / admin).
class AuthHome extends StatefulWidget {
  final User? user;

  /// When opening the member (client) shell, optionally land on a tab
  /// (e.g. coaches after register — matches web `/member/coaches`).
  final int? memberInitialTabIndex;

  const AuthHome({
    super.key,
    required this.user,
    this.memberInitialTabIndex,
  });

  @override
  State<AuthHome> createState() => _AuthHomeState();
}

class _AuthHomeState extends State<AuthHome> {
  Widget? _home;
  String? _error;

  @override
  void initState() {
    super.initState();
    _resolveHome();
  }

  @override
  void didUpdateWidget(covariant AuthHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.user?.id != widget.user?.id ||
        oldWidget.user?.role != widget.user?.role ||
        oldWidget.user?.mustChangePassword != widget.user?.mustChangePassword ||
        oldWidget.user?.coachApplicationStatus !=
            widget.user?.coachApplicationStatus ||
        oldWidget.memberInitialTabIndex != widget.memberInitialTabIndex) {
      _home = null;
      _error = null;
      _resolveHome();
    }
  }

  Future<void> _resolveHome() async {
    try {
      final home = await AuthRouting.resolveHome(
        widget.user,
        memberInitialTabIndex: widget.memberInitialTabIndex,
      ).timeout(const Duration(seconds: 4));
      if (!mounted) return;
      setState(() {
        _home = home;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      // Never leave the app on a permanent spinner — fall back to sync routing.
      setState(() {
        _home = AuthRouting.homeForUser(
          widget.user,
          memberInitialTabIndex: widget.memberInitialTabIndex,
        );
        _error = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(_error!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    setState(() {
                      _home = null;
                      _error = null;
                    });
                    _resolveHome();
                  },
                  child: const Text('Retry'),
                ),
                TextButton(
                  onPressed: () {
                    setState(() => _home = const LoginScreen());
                  },
                  child: const Text('Go to Login'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (_home == null) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(color: CoachDashboardTheme.primary),
        ),
      );
    }
    return _home!;
  }
}
