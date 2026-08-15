import 'package:flutter/material.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../../../models/user_model.dart';
import '../../../models/progress_model.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/tab_refresh.dart';
import '../../../widgets/animations/animations.dart';
import 'dart:math' as math;
import '../../../utils/async_load.dart';
import '../../../utils/field_validation.dart';
import '../../../utils/share_helpers.dart';
import '../invite_friends_screen.dart';

class UserProgressTab extends StatefulWidget {
  final User user;

  const UserProgressTab({super.key, required this.user});

  @override
  State<UserProgressTab> createState() => UserProgressTabState();
}

class UserProgressTabState extends State<UserProgressTab> with SingleTickerProviderStateMixin, TabRefreshMixin {
  final ApiService _apiService = ApiService();
  ProgressData? _progressData;
  int _workoutCompletionPercent = 0;
  late AnimationController _animCtrl;
  // Local copy of weight so we can update UI without mutating immutable Profile
  double? _localWeightKg;

  @override
  void initState() {
    super.initState();
    _localWeightKg = widget.user.profile?.weightKg;
    _animCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1000));
    _fetchProgress();
  }

  Future<void> refreshFromParent() => _fetchProgress(isRefresh: true);

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  Future<void> _fetchProgress({bool isRefresh = false}) async {
    beginTabLoad(isRefresh: isRefresh);
    try {
      final results = await waitIsolatedTimed<Object?>([
        _apiService.getProgress(),
        _apiService.getUserWorkoutProgress(),
      ], fallback: null, timeout: const Duration(seconds: 20));
      final progress = results[0] is ProgressData ? results[0] as ProgressData : null;
      final workoutProgress = results[1] is Map
          ? Map<String, dynamic>.from(results[1] as Map)
          : <String, dynamic>{};
      if (progress == null && workoutProgress.isEmpty) {
        finishTabError(
          Exception('Unable to load data. Please retry.'),
          isRefresh: isRefresh,
        );
        return;
      }
      final summary = workoutProgress['summary'] as Map<String, dynamic>?;
      final percent = (summary?['completionPercent'] as num?)?.toInt()
          ?? (workoutProgress['completionPercent'] as num?)?.toInt()
          ?? 0;
      if (mounted) {
        final firstLoad = !tabHasLoadedOnce;
        finishTabLoad(() {
          if (progress != null) _progressData = progress;
          _workoutCompletionPercent = percent.clamp(0, 100);
        });
        if (firstLoad) {
          _animCtrl.forward(from: 0);
        } else {
          _animCtrl.value = 1.0;
        }
      }
    } catch (e) {
      finishTabError(e, isRefresh: isRefresh);
    } finally {
      if (mounted && (tabIsLoading || tabIsRefreshing)) {
        setState(() {
          tabIsLoading = false;
          tabIsRefreshing = false;
        });
      }
    }
  }

  void _showLogWeightDialog() {
    final ctrl = TextEditingController(text: _localWeightKg?.toString() ?? widget.user.profile?.weightKg?.toString() ?? '');
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text('Log Weight'),
          content: TextField(
            controller: ctrl,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Weight (kg)',
              suffixText: 'kg',
              border: OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: CoachDashboardTheme.primary, foregroundColor: Colors.white),
              onPressed: () async {
                final error = validateWeight(ctrl.text);
                if (error != null) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(error),
                    backgroundColor: Colors.redAccent,
                  ));
                  return;
                }
                final w = double.parse(ctrl.text.trim());
                Navigator.pop(ctx);
                try {
                  await _apiService.updateProfile(weightKg: w);
                  if (mounted) {
                    setState(() => _localWeightKg = w);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('✅ Weight logged!'),
                      backgroundColor: Colors.green,
                    ));
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                      content: Text(ApiService.friendlyError(e)),
                      backgroundColor: Colors.redAccent,
                    ));
                  }
                }
              },
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
  }

  double get _bmi {
    final h = widget.user.profile?.heightCm;
    final w = _localWeightKg ?? widget.user.profile?.weightKg;
    return calcBmi(h, w) ?? 0;
  }

  String _bmiCategory(double bmi) {
    return bmiCategory(bmi) ?? 'Unknown';
  }

  Color _bmiColor(double bmi) {
    if (bmi == 0) return Colors.grey;
    if (bmi < 18.5) return const Color(0xFF29B6F6);
    if (bmi < 25) return const Color(0xFF00D4AA);
    if (bmi < 30) return const Color(0xFFFFB74D);
    return const Color(0xFFFF6B6B);
  }

  int get _completionPercentage => _workoutCompletionPercent;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: CoachDashboardTheme.coachAppBar(
        context: context,
        title: 'My Progress',
        actions: [
          IconButton(
            icon: const Icon(Icons.ios_share_rounded),
            tooltip: 'Share progress',
            onPressed: () => shareVitalCard(context, type: 'progress'),
          ),
          IconButton(
            icon: const Icon(Icons.person_add_alt_1_rounded),
            tooltip: 'Invite friends',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const InviteFriendsScreen()),
              );
            },
          ),
          IconButton(icon: const Icon(Icons.monitor_weight_outlined), onPressed: _showLogWeightDialog, tooltip: 'Log Weight'),
          IconButton(
            icon: tabRefreshIcon(color: Colors.white),
            onPressed: (showInitialLoading || tabIsRefreshing) ? null : () => _fetchProgress(isRefresh: true),
          ),
        ],
      ),
      body: showInitialError
              ? ScrollableCenter(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Icon(Icons.error_outline_rounded, color: Color(0xFFFF6B6B), size: 48),
                    const SizedBox(height: 12),
                    Text(tabLoadError!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
                    const SizedBox(height: 16),
                    ElevatedButton(onPressed: () => _fetchProgress(), child: const Text('Retry')),
                  ]),
                )
              : PremiumRefreshIndicator(
                  onRefresh: () => _fetchProgress(isRefresh: true),
                  child: refreshableScrollChild(
                    context: context,
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      // Body Composition
                      Text('Body Composition', style: CoachDashboardTheme.sectionTitle(isDark)).staggerIn(0),
                      const SizedBox(height: 12),
                      Row(children: [
                        Expanded(child: PremiumCard(index: 1, child: _buildWeightCard(isDark))),
                        const SizedBox(width: 12),
                        Expanded(child: PremiumCard(index: 2, child: _buildBMICard(isDark))),
                      ]),
                      const SizedBox(height: 24),
                      
                      // Workout Completion
                      Text('Activity Performance', style: CoachDashboardTheme.sectionTitle(isDark)).staggerIn(3),
                      const SizedBox(height: 12),
                      PremiumCard(index: 4, child: _buildCompletionCard(isDark)),
                      const SizedBox(height: 12),
                      AnimatedStatBar(
                        value: _completionPercentage.toDouble(),
                        color: const Color(0xFF00D4AA),
                        backgroundColor: isDark ? Colors.white12 : const Color(0xFFE8ECF0),
                      ).staggerIn(5),
                      const SizedBox(height: 24),

                      // Weekly Chart
                      Text('Last 7 Days · Calories Burned', style: CoachDashboardTheme.sectionTitle(isDark)).staggerIn(6),
                      const SizedBox(height: 12),
                      PremiumCard(index: 7, child: _buildWeeklyChart(isDark)),
                      const SizedBox(height: 24),

                      // Goals
                      Text('Fitness Goals', style: CoachDashboardTheme.sectionTitle(isDark)).staggerIn(8),
                      const SizedBox(height: 12),
                      PremiumCard(index: 9, child: _buildGoalsCard(isDark)),
                    ]),
                  ),
                ),
    );
  }

  Widget _buildWeightCard(bool isDark) {
    // Use local weight when available (after user logs a new value)
    final weight = _localWeightKg ?? widget.user.profile?.weightKg;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.3 : 0.05), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: CoachDashboardTheme.primary.withOpacity(0.15), shape: BoxShape.circle),
            child: const Icon(Icons.monitor_weight_rounded, color: CoachDashboardTheme.primary, size: 18),
          ),
          const SizedBox(width: 8),
          const Text('Weight', style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey)),
        ]),
        const SizedBox(height: 12),
        if (weight != null) ...[
          AnimatedStatValue(
            value: weight,
            fractionDigits: 1,
            suffix: ' kg',
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          const Text('Current weight', style: TextStyle(fontSize: 12, color: Colors.grey)),
        ] else
          const Text('Not set', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey)),
      ]),
    );
  }

  Widget _buildBMICard(bool isDark) {
    final bmi = _bmi;
    final cat = _bmiCategory(bmi);
    final col = _bmiColor(bmi);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.3 : 0.05), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: col.withOpacity(0.15), shape: BoxShape.circle),
            child: Icon(Icons.straighten_rounded, color: col, size: 18),
          ),
          const SizedBox(width: 8),
          const Text('BMI', style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey)),
        ]),
        const SizedBox(height: 12),
        if (bmi > 0) ...[
          AnimatedStatValue(
            value: bmi,
            fractionDigits: 1,
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(cat, style: TextStyle(fontSize: 12, color: col, fontWeight: FontWeight.bold)),
        ] else
          const Text('Not set', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey)),
      ]),
    );
  }

  Widget _buildCompletionCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: CoachDashboardTheme.headerGradient,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: CoachDashboardTheme.primary.withOpacity(0.3), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Workout Completion', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('Based on assigned workouts & logged activities.', style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12)),
          ]),
        ),
        const SizedBox(width: 20),
        SizedBox(
          width: 70, height: 70,
          child: AnimatedBuilder(
            animation: _animCtrl,
            builder: (ctx, child) {
              final pct = _completionPercentage * _animCtrl.value;
              return Stack(
                fit: StackFit.expand,
                children: [
                  const SizedBox.shrink(),
                  Center(child: Text('${pct.toInt()}%', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16))),
                ],
              );
            },
          ),
        ),
      ]),
    );
  }

  Widget _buildWeeklyChart(bool isDark) {
    final points = _progressData?.trends.caloriesOut ?? const <ProgressTrendPoint>[];
    final data = points.isNotEmpty
        ? points.map((p) => p.value).toList()
        : List<double>.filled(7, 0);
    final labels = points.isNotEmpty
        ? points.map((p) => p.shortWeekday).toList()
        : const ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    final hasAny = data.any((v) => v > 0);

    return Container(
      height: 200,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: isDark ? 0.3 : 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: hasAny
          ? AnimatedBuilder(
              animation: _animCtrl,
              builder: (ctx, child) => CustomPaint(
                painter: _BarChartPainter(
                  isDark: isDark,
                  progress: _animCtrl.value,
                  data: data,
                  labels: labels,
                ),
              ),
            )
          : Center(
              child: Text(
                'No approved workouts logged this week yet.',
                textAlign: TextAlign.center,
                style: CoachDashboardTheme.bodyMuted(isDark),
              ),
            ),
    );
  }

  Widget _buildGoalsCard(bool isDark) {
    final goals = widget.user.profile?.goals ?? [];
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.3 : 0.05), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: goals.isEmpty
          ? const Center(child: Text('No goals set. Update your settings!', style: TextStyle(color: Colors.grey)))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: goals.asMap().entries.map((entry) {
                final i = entry.key;
                final g = entry.value;
                final isLast = i == goals.length - 1;
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF00D4AA).withOpacity(0.15),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.flag_rounded, color: Color(0xFF00D4AA), size: 18),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              g,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: isDark ? Colors.white : Colors.black87,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (!isLast) Divider(height: 1, color: isDark ? Colors.white12 : Colors.grey.shade200),
                  ],
                );
              }).toList(),
            ),
    );
  }
}

class _BarChartPainter extends CustomPainter {
  final bool isDark;
  final double progress;
  final List<double> data;
  final List<String> labels;

  _BarChartPainter({required this.isDark, required this.progress, required this.data, required this.labels});

  @override
  void paint(Canvas canvas, Size size) {
    final maxVal = data.reduce(math.max) == 0 ? 100.0 : data.reduce(math.max);
    final barW = size.width / (data.length * 2);
    final gap = size.width / data.length;

    final paintBg = Paint()
      ..color = isDark ? Colors.white.withOpacity(0.05) : Colors.black.withOpacity(0.04)
      ..style = PaintingStyle.fill;
    
    final paintFg = Paint()
      ..color = CoachDashboardTheme.primary
      ..style = PaintingStyle.fill;

    final textStyle = TextStyle(color: Colors.grey[500], fontSize: 11);

    for (int i = 0; i < data.length; i++) {
      final x = gap * i + (gap - barW) / 2;
      final h = (data[i] / maxVal) * (size.height - 30) * progress;
      
      final bgRect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, 0, barW, size.height - 30),
        const Radius.circular(6),
      );
      canvas.drawRRect(bgRect, paintBg);

      final fgRect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, size.height - 30 - h, barW, h),
        const Radius.circular(6),
      );
      canvas.drawRRect(fgRect, paintFg);

      final textSpan = TextSpan(text: labels[i], style: textStyle);
      final textPainter = TextPainter(text: textSpan, textDirection: TextDirection.ltr);
      textPainter.layout();
      textPainter.paint(canvas, Offset(x + barW / 2 - textPainter.width / 2, size.height - 20));
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}
