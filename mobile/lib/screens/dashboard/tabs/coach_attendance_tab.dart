import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class CoachAttendanceTab extends StatefulWidget {
  const CoachAttendanceTab({super.key});

  @override
  State<CoachAttendanceTab> createState() => _CoachAttendanceTabState();
}

class _CoachAttendanceTabState extends State<CoachAttendanceTab> {
  final ApiService _api = ApiService();
  bool _loading = true;
  String? _error;
  String _range = 'week';
  String _type = 'all';
  String _status = 'all';
  /// 0 = By User, 1 = By Group
  int _viewMode = 0;
  Map<String, dynamic> _stats = {};
  List<dynamic> _items = [];
  Map<String, dynamic> _summary = {};
  List<dynamic> _clients = [];
  List<dynamic> _groups = [];

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
      final range = _range == 'all' ? null : _range;
      final type = _type == 'all' ? null : _type;
      final results = await Future.wait([
        _api.getCoachAttendance(
          range: range,
          type: type,
          status: _status == 'all' ? null : _status,
        ),
        _api.getCoachAttendanceSummary(),
        _api.getAttendanceByClients(range: range, type: type),
        _api.getAttendanceByGroups(range: range),
      ]);
      if (!mounted) return;
      final data = results[0];
      setState(() {
        _items = List<dynamic>.from(data['items'] as List? ?? const []);
        _stats = Map<String, dynamic>.from(data['stats'] as Map? ?? const {});
        _summary = Map<String, dynamic>.from(
          (results[1]['summary'] as Map?) ?? const {},
        );
        _clients = List<dynamic>.from(results[2]['items'] as List? ?? const []);
        _groups = List<dynamic>.from(results[3]['items'] as List? ?? const []);
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
      case 'cancelled':
        return Colors.grey;
      default:
        return CoachDashboardTheme.primary;
    }
  }

  Future<void> _updateStatus(Map item, String status) async {
    try {
      await _api.updateAttendanceRecord(item['_id'].toString(), status: status);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiService.friendlyError(e))),
      );
    }
  }

  List<String> _statusesFor(String type) {
    switch (type) {
      case 'workout':
        return ['present', 'absent', 'completed', 'missed'];
      case 'session':
        return ['present', 'absent', 'no_show', 'cancelled', 'completed'];
      case 'group':
        return ['present', 'absent', 'no_show'];
      case 'daily':
      case 'coach':
        return ['present', 'absent'];
      default:
        return ['present', 'absent', 'completed', 'missed', 'no_show', 'cancelled'];
    }
  }

  void _openClient(Map row) {
    final client = row['client'];
    final id = (row['clientId'] ?? (client is Map ? client['_id'] : null))?.toString();
    if (id == null || id.isEmpty) return;
    final name = client is Map
        ? (client['full_name'] ?? client['username'] ?? 'Client').toString()
        : 'Client';
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ClientAttendanceDetailScreen(
          clientId: id,
          clientName: name,
          range: _range == 'all' ? null : _range,
          type: _type == 'all' ? null : _type,
        ),
      ),
    );
  }

  void _openGroup(Map row) {
    final group = row['group'];
    final id = (row['groupId'] ?? (group is Map ? group['_id'] : null))?.toString();
    if (id == null || id.isEmpty) return;
    final name = group is Map ? (group['title'] ?? 'Group').toString() : 'Group';
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _GroupAttendanceDetailScreen(
          groupId: id,
          groupName: name,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return CoachPage(
      title: 'Attendance',
      actions: [
        IconButton(
          icon: const Icon(Icons.refresh_rounded),
          onPressed: _load,
        ),
      ],
      body: _loading && _clients.isEmpty && _groups.isEmpty && _items.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ScrollableBody(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: Text(_error!, style: const TextStyle(color: CoachDashboardTheme.danger)),
                      ),
                    _summaryRow(isDark),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _chipFilter('Range', _range, ['today', 'week', 'month', 'all'], (v) {
                          setState(() => _range = v);
                          _load();
                        }),
                        _chipFilter('Type', _type, ['all', 'workout', 'session', 'group', 'daily'], (v) {
                          setState(() => _type = v);
                          _load();
                        }),
                        _chipFilter('Status', _status, ['all', 'present', 'absent', 'missed', 'no_show', 'completed'], (v) {
                          setState(() => _status = v);
                          _load();
                        }),
                      ],
                    ),
                    const SizedBox(height: 16),
                    _statGrid(isDark),
                    const SizedBox(height: 16),
                    _viewToggle(isDark),
                    const SizedBox(height: 12),
                    if (_viewMode == 0) ...[
                      Text('By User', style: CoachDashboardTheme.sectionTitle(isDark)),
                      const SizedBox(height: 8),
                      if (_clients.isEmpty)
                        Text(
                          'No assigned clients yet.',
                          style: TextStyle(color: isDark ? Colors.white60 : Colors.black54),
                        )
                      else
                        ..._clients.map((raw) {
                          final row = Map<String, dynamic>.from(raw as Map);
                          final client = row['client'];
                          final name = client is Map
                              ? (client['full_name'] ?? client['username'] ?? 'Client').toString()
                              : 'Client';
                          final stats = Map<String, dynamic>.from(row['stats'] as Map? ?? const {});
                          return _overviewCard(
                            isDark: isDark,
                            title: name,
                            subtitle:
                                'Total ${stats['total'] ?? 0} · Present ${stats['present'] ?? 0} · '
                                'Absent ${stats['absent'] ?? 0} · Missed ${stats['missed'] ?? 0} · '
                                'No Show ${stats['no_show'] ?? 0}',
                            trailing: '${stats['attendancePercentage'] ?? 0}%',
                            actionLabel: 'View Attendance',
                            onTap: () => _openClient(row),
                          );
                        }),
                    ] else ...[
                      Text('By Group', style: CoachDashboardTheme.sectionTitle(isDark)),
                      const SizedBox(height: 8),
                      if (_groups.isEmpty)
                        Text(
                          'No groups yet.',
                          style: TextStyle(color: isDark ? Colors.white60 : Colors.black54),
                        )
                      else
                        ..._groups.map((raw) {
                          final row = Map<String, dynamic>.from(raw as Map);
                          final group = row['group'];
                          final name = group is Map
                              ? (group['title'] ?? 'Group').toString()
                              : 'Group';
                          final stats = Map<String, dynamic>.from(row['stats'] as Map? ?? const {});
                          return _overviewCard(
                            isDark: isDark,
                            title: name,
                            subtitle:
                                '${stats['totalMembers'] ?? 0} Members → '
                                '${stats['present'] ?? 0} Present → '
                                '${stats['absent'] ?? 0} Absent → '
                                '${stats['no_show'] ?? 0} No Show',
                            trailing: '${stats['attendancePercentage'] ?? 0}%',
                            actionLabel: 'View Group Attendance',
                            onTap: () => _openGroup(row),
                          );
                        }),
                    ],
                    const SizedBox(height: 20),
                    Text('Recent history', style: CoachDashboardTheme.sectionTitle(isDark)),
                    const SizedBox(height: 8),
                    if (_items.isEmpty)
                      Text(
                        'No attendance records yet.',
                        style: TextStyle(color: isDark ? Colors.white60 : Colors.black54),
                      )
                    else
                      ..._items.map((raw) {
                        final item = Map<String, dynamic>.from(raw as Map);
                        final user = item['user'];
                        final name = user is Map
                            ? (user['full_name'] ?? user['username'] ?? 'Client').toString()
                            : 'Client';
                        final type = (item['type'] ?? '').toString();
                        final status = (item['status'] ?? '').toString();
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(14),
                          decoration: CoachDashboardTheme.cardDecoration(isDark),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      name,
                                      style: const TextStyle(fontWeight: FontWeight.w700),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: _statusColor(status).withValues(alpha: 0.15),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Text(
                                      status.replaceAll('_', ' '),
                                      style: TextStyle(
                                        color: _statusColor(status),
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${type.toUpperCase()} · ${_formatDate(item['date'] ?? item['scheduledStart'])}',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: isDark ? Colors.white60 : Colors.black54,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                children: _statusesFor(type).map((s) {
                                  return ActionChip(
                                    label: Text(s.replaceAll('_', ' ')),
                                    onPressed: () => _updateStatus(item, s),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _viewToggle(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: isDark ? Colors.white10 : Colors.black.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _toggleButton('By User', 0, isDark),
          _toggleButton('By Group', 1, isDark),
        ],
      ),
    );
  }

  Widget _toggleButton(String label, int index, bool isDark) {
    final selected = _viewMode == index;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          if (_viewMode == index) return;
          setState(() => _viewMode = index);
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? CoachDashboardTheme.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: selected
                  ? Colors.white
                  : (isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
            ),
          ),
        ),
      ),
    );
  }

  Widget _overviewCard({
    required bool isDark,
    required String title,
    required String subtitle,
    required String trailing,
    required String actionLabel,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: CoachDashboardTheme.cardDecoration(isDark),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: TextStyle(fontSize: 12, color: isDark ? Colors.white60 : Colors.black54),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    actionLabel,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: CoachDashboardTheme.primary,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              children: [
                Text(trailing, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                Icon(
                  Icons.chevron_right_rounded,
                  color: isDark ? Colors.white38 : Colors.black38,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryRow(bool isDark) {
    Widget card(String label, Map? data) {
      final pct = data?['attendancePercentage'] ?? 0;
      return Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: CoachDashboardTheme.cardDecoration(isDark),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(fontSize: 12, color: isDark ? Colors.white60 : Colors.black54)),
              const SizedBox(height: 4),
              Text('$pct%', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
      );
    }

    return Row(
      children: [
        card('Today', _summary['today'] as Map?),
        const SizedBox(width: 8),
        card('Week', _summary['week'] as Map?),
        const SizedBox(width: 8),
        card('Month', _summary['month'] as Map?),
      ],
    );
  }

  Widget _statGrid(bool isDark) {
    final cards = [
      ('Clients', _stats['totalClients'] ?? 0),
      ('Present', _stats['present'] ?? 0),
      ('Absent', _stats['absent'] ?? 0),
      ('Missed', _stats['missed'] ?? 0),
      ('No Show', _stats['no_show'] ?? 0),
      ('Rate', '${_stats['attendancePercentage'] ?? 0}%'),
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: cards.map((c) {
        return Container(
          width: (MediaQuery.of(context).size.width - 48) / 3,
          padding: const EdgeInsets.all(12),
          decoration: CoachDashboardTheme.cardDecoration(isDark),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(c.$1, style: TextStyle(fontSize: 11, color: isDark ? Colors.white60 : Colors.black54)),
              const SizedBox(height: 4),
              Text('${c.$2}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _chipFilter(String label, String value, List<String> options, ValueChanged<String> onChanged) {
    return PopupMenuButton<String>(
      onSelected: onChanged,
      itemBuilder: (_) => options
          .map((o) => PopupMenuItem(value: o, child: Text(o)))
          .toList(),
      child: Chip(label: Text('$label: $value')),
    );
  }

  String _formatDate(dynamic value) {
    if (value == null) return '—';
    final d = DateTime.tryParse(value.toString());
    if (d == null) return value.toString();
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

class _ClientAttendanceDetailScreen extends StatefulWidget {
  final String clientId;
  final String clientName;
  final String? range;
  final String? type;

  const _ClientAttendanceDetailScreen({
    required this.clientId,
    required this.clientName,
    this.range,
    this.type,
  });

  @override
  State<_ClientAttendanceDetailScreen> createState() => _ClientAttendanceDetailScreenState();
}

class _ClientAttendanceDetailScreenState extends State<_ClientAttendanceDetailScreen> {
  final ApiService _api = ApiService();
  bool _loading = true;
  String? _error;
  List<dynamic> _items = [];
  Map<String, dynamic> _stats = {};

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
      final data = await _api.getClientAttendanceDetail(
        widget.clientId,
        range: widget.range,
        type: widget.type,
      );
      if (!mounted) return;
      setState(() {
        _items = List<dynamic>.from(data['items'] as List? ?? const []);
        _stats = Map<String, dynamic>.from(data['stats'] as Map? ?? const {});
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

  Future<void> _updateStatus(Map item, String status) async {
    try {
      await _api.updateAttendanceRecord(item['_id'].toString(), status: status);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiService.friendlyError(e))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        title: Text(widget.clientName),
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
                      padding: const EdgeInsets.all(14),
                      decoration: CoachDashboardTheme.cardDecoration(isDark),
                      child: Text(
                        'Total ${_stats['total'] ?? 0} · Present ${_stats['present'] ?? 0} · '
                        'Absent ${_stats['absent'] ?? 0} · Missed ${_stats['missed'] ?? 0} · '
                        'No Show ${_stats['no_show'] ?? 0} · ${_stats['attendancePercentage'] ?? 0}%',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (_items.isEmpty)
                      const Text('No attendance history for this client.')
                    else
                      ..._items.map((raw) {
                        final item = Map<String, dynamic>.from(raw as Map);
                        final type = (item['type'] ?? '').toString();
                        final status = (item['status'] ?? '').toString();
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(14),
                          decoration: CoachDashboardTheme.cardDecoration(isDark),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${type.toUpperCase()} · $status',
                                style: const TextStyle(fontWeight: FontWeight.w700),
                              ),
                              const SizedBox(height: 6),
                              Text((item['date'] ?? '').toString()),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                children: [
                                  for (final s in _detailStatuses(type))
                                    ActionChip(
                                      label: Text(s.replaceAll('_', ' ')),
                                      onPressed: () => _updateStatus(item, s),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
    );
  }

  List<String> _detailStatuses(String type) {
    switch (type) {
      case 'workout':
        return ['present', 'absent', 'completed', 'missed'];
      case 'session':
        return ['present', 'absent', 'no_show', 'cancelled', 'completed'];
      case 'group':
        return ['present', 'absent', 'no_show'];
      default:
        return ['present', 'absent'];
    }
  }
}

class _GroupAttendanceDetailScreen extends StatefulWidget {
  final String groupId;
  final String groupName;

  const _GroupAttendanceDetailScreen({
    required this.groupId,
    required this.groupName,
  });

  @override
  State<_GroupAttendanceDetailScreen> createState() => _GroupAttendanceDetailScreenState();
}

class _GroupAttendanceDetailScreenState extends State<_GroupAttendanceDetailScreen> {
  final ApiService _api = ApiService();
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _group = {};
  Map<String, dynamic> _stats = {};
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
      final data = await _api.getGroupAttendance(widget.groupId);
      if (!mounted) return;
      setState(() {
        _group = Map<String, dynamic>.from(data['group'] as Map? ?? const {});
        _stats = Map<String, dynamic>.from(data['stats'] as Map? ?? const {});
        _items = List<dynamic>.from(data['items'] as List? ?? const []);
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

  Future<void> _updateStatus(Map item, String status) async {
    try {
      await _api.updateAttendanceRecord(item['_id'].toString(), status: status);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiService.friendlyError(e))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        title: Text(widget.groupName),
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
                      padding: const EdgeInsets.all(14),
                      decoration: CoachDashboardTheme.cardDecoration(isDark),
                      child: Text(
                        '${_stats['totalMembers'] ?? _group['totalMembers'] ?? 0} Members → '
                        '${_stats['present'] ?? 0} Present → '
                        '${_stats['absent'] ?? 0} Absent → '
                        '${_stats['no_show'] ?? 0} No Show · '
                        '${_stats['attendancePercentage'] ?? 0}%',
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (_items.isEmpty)
                      const Text('No member attendance for this group yet.')
                    else
                      ..._items.map((raw) {
                        final item = Map<String, dynamic>.from(raw as Map);
                        final user = item['user'];
                        final name = user is Map
                            ? (user['full_name'] ?? user['username'] ?? 'Member').toString()
                            : 'Member';
                        final status = (item['status'] ?? 'absent').toString();
                        return Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(14),
                          decoration: CoachDashboardTheme.cardDecoration(isDark),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(fontWeight: FontWeight.w700)),
                              const SizedBox(height: 4),
                              Text('Status: ${status.replaceAll('_', ' ')}'),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 6,
                                children: [
                                  for (final s in ['present', 'absent', 'no_show'])
                                    ActionChip(
                                      label: Text(s.replaceAll('_', ' ')),
                                      onPressed: () => _updateStatus(item, s),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
    );
  }
}
