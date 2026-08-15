import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class UserAttendanceScreen extends StatefulWidget {
  const UserAttendanceScreen({super.key});

  @override
  State<UserAttendanceScreen> createState() => _UserAttendanceScreenState();
}

class _UserAttendanceScreenState extends State<UserAttendanceScreen> {
  final ApiService _api = ApiService();
  bool _loading = true;
  String? _error;
  String _range = 'month';
  Map<String, dynamic> _stats = {};
  Map<String, dynamic> _summary = {};
  List<dynamic> _items = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _api.getMyAttendance(range: _range == 'all' ? null : _range),
        _api.getMyAttendanceSummary(),
      ]);
      if (!mounted) return;
      setState(() {
        _items = List<dynamic>.from(results[0]['items'] as List? ?? const []);
        _stats = Map<String, dynamic>.from(results[0]['stats'] as Map? ?? const {});
        _summary = Map<String, dynamic>.from(results[1]['summary'] as Map? ?? const {});
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiService.friendlyError(e);
        _loading = false;
      });
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'present':
      case 'completed':
        return CoachDashboardTheme.success;
      case 'absent':
      case 'missed':
      case 'no_show':
        return CoachDashboardTheme.danger;
      default:
        return CoachDashboardTheme.primary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final all = Map<String, dynamic>.from(_summary['all'] as Map? ?? _stats);
    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        title: const Text('My Attendance'),
        backgroundColor: CoachDashboardTheme.primary,
        foregroundColor: Colors.white,
      ),
      body: _loading && _items.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ScrollableBody(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_error != null)
                      Text(_error!, style: const TextStyle(color: CoachDashboardTheme.danger)),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: CoachDashboardTheme.cardDecoration(isDark),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Attendance rate', style: TextStyle(fontWeight: FontWeight.w600)),
                          const SizedBox(height: 6),
                          Text(
                            '${all['attendancePercentage'] ?? 0}%',
                            style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Present ${all['present'] ?? 0} · Absent ${all['absent'] ?? 0} · Missed ${all['missed'] ?? 0}',
                            style: TextStyle(color: isDark ? Colors.white70 : Colors.black54),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      children: ['week', 'month', 'all'].map((r) {
                        final selected = _range == r;
                        return ChoiceChip(
                          label: Text(r),
                          selected: selected,
                          onSelected: (_) {
                            setState(() => _range = r);
                            _load();
                          },
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),
                    Text('History', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    if (_items.isEmpty)
                      Text(
                        'No attendance history yet.',
                        style: TextStyle(color: isDark ? Colors.white60 : Colors.black54),
                      )
                    else
                      ..._items.map((raw) {
                        final item = Map<String, dynamic>.from(raw as Map);
                        final status = (item['status'] ?? '').toString();
                        final type = (item['type'] ?? '').toString();
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(type.toUpperCase()),
                          subtitle: Text(_formatDate(item['date'] ?? item['scheduledStart'])),
                          trailing: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: _statusColor(status).withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              status.replaceAll('_', ' '),
                              style: TextStyle(
                                color: _statusColor(status),
                                fontWeight: FontWeight.w700,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
    );
  }

  String _formatDate(dynamic value) {
    if (value == null) return '—';
    final d = DateTime.tryParse(value.toString());
    if (d == null) return value.toString();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}
