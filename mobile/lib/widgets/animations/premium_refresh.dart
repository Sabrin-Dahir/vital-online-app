import 'package:flutter/material.dart';
import 'app_motion.dart';
import '../../screens/dashboard/widgets/coach_home/coach_dashboard_theme.dart';

/// RefreshIndicator wrapper with smooth color animation and optional overlay.
class PremiumRefreshIndicator extends StatelessWidget {
  final Future<void> Function() onRefresh;
  final Widget child;
  final Color? color;

  const PremiumRefreshIndicator({
    super.key,
    required this.onRefresh,
    required this.child,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final refreshColor = color ?? CoachDashboardTheme.primary;

    return RefreshIndicator(
      onRefresh: onRefresh,
      color: refreshColor,
      backgroundColor: Theme.of(context).brightness == Brightness.dark
          ? const Color(0xFF181B24)
          : Colors.white,
      strokeWidth: 2.5,
      displacement: 48,
      edgeOffset: 8,
      child: child,
    );
  }
}

/// Cross-fade between loading and content states.
class AnimatedContentSwitcher extends StatelessWidget {
  final Widget child;
  final Duration duration;

  const AnimatedContentSwitcher({
    super.key,
    required this.child,
    this.duration = AppMotion.normal,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: duration,
      switchInCurve: AppMotion.easeOut,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) {
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 0.02),
              end: Offset.zero,
            ).animate(animation),
            child: child,
          ),
        );
      },
      child: child,
    );
  }
}
