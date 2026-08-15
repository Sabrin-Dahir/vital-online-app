import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class CoachReportsTab extends StatefulWidget {
  const CoachReportsTab({super.key});

  @override
  State<CoachReportsTab> createState() => _CoachReportsTabState();
}

class _CoachReportsTabState extends State<CoachReportsTab> {
  final ApiService _api = ApiService();
  bool _isLoading = true;
  Map<String, dynamic>? _reports;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final data = await _api.getCoachReports();
      if (mounted) setState(() { _reports = data; });
    } catch (e) {
      if (mounted) setState(() { _error = ApiService.friendlyError(e); });
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return CoachPage(
      title: 'Reports & Analytics',
      actions: [IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _load)],
      body: _buildBody(isDark),
    );
  }

  Widget _buildBody(bool isDark) {
    if (_isLoading) return const ScrollableCenter(child: CircularProgressIndicator());
    if (_error != null) {
      return ScrollableCenter(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    final r = _reports!;
    final activities = (r['activitiesByType'] as List<dynamic>? ?? []);

    return ListView(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
      children: [
        _sectionTitle('Overview', Icons.insights_rounded, CoachDashboardTheme.primary, isDark),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.4,
          children: [
            _statCard('Clients', '${r['totalClients'] ?? 0}', CoachDashboardTheme.primary, isDark),
            _statCard('Sessions', '${r['totalSessions'] ?? 0}', CoachDashboardTheme.accent, isDark),
            _statCard('Attendance', '${r['attendanceRate'] ?? 0}%', CoachDashboardTheme.success, isDark),
            _statCard('Workout Rate', '${r['workoutCompletionRate'] ?? 0}%', CoachDashboardTheme.warning, isDark),
          ],
        ),
        const SizedBox(height: 24),
        _sectionTitle('Workout Completion', Icons.fitness_center_rounded, CoachDashboardTheme.danger, isDark),
        const SizedBox(height: 12),
        _card(isDark, child: Column(
          children: [
            _row('Approved', '${r['approvedWorkouts'] ?? 0}', Colors.green),
            const Divider(),
            _row('Pending', '${r['pendingWorkouts'] ?? 0}', Colors.orange),
            const Divider(),
            _row('Rejected', '${r['rejectedWorkouts'] ?? 0}', Colors.redAccent),
          ],
        )),
        const SizedBox(height: 24),
        _sectionTitle('Activity Breakdown', Icons.bar_chart_rounded, CoachDashboardTheme.pink, isDark),
        const SizedBox(height: 12),
        if (activities.isEmpty)
          _card(isDark, child: const Text('No activity data yet.'))
        else
          _card(
            isDark,
            child: SizedBox(
              height: 200,
              child: BarChart(
                BarChartData(
                  maxY: activities.map((a) => (a['count'] as num?)?.toDouble() ?? 0).fold<double>(0, (m, v) => v > m ? v : m) + 2,
                  gridData: const FlGridData(show: false),
                  borderData: FlBorderData(show: false),
                  titlesData: FlTitlesData(
                    bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                        showTitles: true,
                        getTitlesWidget: (value, meta) {
                          final i = value.toInt();
                          if (i < 0 || i >= activities.length) return const SizedBox();
                          final label = activities[i]['_id']?.toString() ?? '';
                          return Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(label.length > 6 ? '${label.substring(0, 6)}…' : label, style: const TextStyle(fontSize: 10)),
                          );
                        },
                      ),
                    ),
                    leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 28)),
                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  ),
                  barGroups: List.generate(activities.length, (i) {
                    final count = (activities[i]['count'] as num?)?.toDouble() ?? 0;
                    return BarChartGroupData(
                      x: i,
                      barRods: [
                        BarChartRodData(
                          toY: count,
                          color: CoachDashboardTheme.primary,
                          width: 18,
                          borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                        ),
                      ],
                    );
                  }),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _sectionTitle(String title, IconData icon, Color color, bool isDark) {
    return Row(
      children: [
        Icon(icon, color: color, size: 22),
        const SizedBox(width: 8),
        Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: isDark ? Colors.white : Colors.black87)),
      ],
    );
  }

  Widget _statCard(String label, String value, Color color, bool isDark) {
    return Container(
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(value, style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color)),
          Text(label, style: TextStyle(color: isDark ? Colors.white60 : Colors.black54)),
        ],
      ),
    );
  }

  Widget _card(bool isDark, {required Widget child}) {
    return Container(
      width: double.infinity,
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      padding: const EdgeInsets.all(16),
      child: child,
    );
  }

  Widget _row(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(value, style: TextStyle(fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }
}
