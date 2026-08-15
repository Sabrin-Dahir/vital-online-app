import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import '../../screens/dashboard/widgets/coach_home/coach_dashboard_theme.dart';

/// Smooth Lottie loading indicator with lightweight fallback.
class LottieLoading extends StatelessWidget {
  final double size;
  final Color? color;

  const LottieLoading({super.key, this.size = 72, this.color});

  @override
  Widget build(BuildContext context) {
    final tint = color ?? CoachDashboardTheme.primary;
    return SizedBox(
      width: size,
      height: size,
      child: Lottie.asset(
        'assets/animations/loading.json',
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => CircularProgressIndicator(
          strokeWidth: 2.5,
          color: tint,
        ),
      ),
    );
  }
}

class LottieLoadingCenter extends StatelessWidget {
  final double size;
  const LottieLoadingCenter({super.key, this.size = 80});

  @override
  Widget build(BuildContext context) {
    return Center(child: LottieLoading(size: size));
  }
}
