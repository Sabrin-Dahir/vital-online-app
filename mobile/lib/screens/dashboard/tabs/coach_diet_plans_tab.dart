import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../models/diet_plan_completion_model.dart';
import '../../../models/diet_plan_model.dart';
import '../../../models/diet_today_progress_model.dart';
import '../../../services/api_service.dart';
import '../../../utils/coach_specialization.dart';
import '../../../utils/date_utils.dart';
import '../../../widgets/diet_progress_panel.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class CoachDietPlansTab extends StatefulWidget {
  const CoachDietPlansTab({super.key});

  @override
  State<CoachDietPlansTab> createState() => _CoachDietPlansTabState();
}

Map<String, dynamic> _asJsonMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  throw FormatException('Expected a diet plan object, got ${value.runtimeType}');
}

class _CoachDietPlansTabState extends State<CoachDietPlansTab> with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  final _searchCtrl = TextEditingController();
  final _completionSearchCtrl = TextEditingController();
  late TabController _mainTabs;

  bool _loading = true;
  String _error = '';
  List<DietPlan> _plans = [];
  int _page = 1;
  int _totalPages = 1;
  String _statusFilter = 'all';
  String _assigneeFilter = 'all';
  String _sort = 'newest';

  bool _completionLoading = false;
  String _completionError = '';
  String _completionFilter = 'all';
  String _completionQuery = '';
  List<DietPlanCompletion> _completions = [];
  int _completedCount = 0;
  int _notCompletedCount = 0;
  /// Expanded User Completion cards: "${userId}|${planId}".
  final Set<String> _expandedCompletionKeys = <String>{};

  /// Nested "This week" details inside an expanded completion card.
  final Set<String> _expandedWeekDetailKeys = <String>{};

  /// Collapsed user-group sections (group name or [_individualGroupKey]).
  final Set<String> _collapsedUserGroups = <String>{};

  /// Groups already seen — new groups start collapsed.
  final Set<String> _knownUserGroupKeys = <String>{};

  static const String _individualGroupKey = '__individual__';

  String _completionKey(DietPlanCompletion item) => '${item.userId}|${item.planId}';

  String _userGroupKey(DietPlanCompletion item) {
    final name = item.groupName?.trim();
    if (name == null || name.isEmpty) return _individualGroupKey;
    return name;
  }

  String _userGroupTitle(String key) =>
      key == _individualGroupKey ? 'Users · Individual' : 'Users · $key';

  List<MapEntry<String, List<DietPlanCompletion>>> _groupedCompletions(
    List<DietPlanCompletion> list,
  ) {
    final map = <String, List<DietPlanCompletion>>{};
    for (final item in list) {
      map.putIfAbsent(_userGroupKey(item), () => []).add(item);
    }
    final entries = map.entries.toList()
      ..sort((a, b) {
        if (a.key == _individualGroupKey) return 1;
        if (b.key == _individualGroupKey) return -1;
        return a.key.toLowerCase().compareTo(b.key.toLowerCase());
      });
    for (final entry in entries) {
      entry.value.sort(
        (a, b) => a.userName.toLowerCase().compareTo(b.userName.toLowerCase()),
      );
    }
    return entries;
  }

  void _toggleCompletionExpanded(DietPlanCompletion item) {
    final key = _completionKey(item);
    setState(() {
      if (_expandedCompletionKeys.contains(key)) {
        _expandedCompletionKeys.remove(key);
        _expandedWeekDetailKeys.remove(key);
      } else {
        _expandedCompletionKeys.add(key);
      }
    });
  }

  void _toggleWeekDetailExpanded(DietPlanCompletion item) {
    final key = _completionKey(item);
    setState(() {
      if (_expandedWeekDetailKeys.contains(key)) {
        _expandedWeekDetailKeys.remove(key);
      } else {
        _expandedWeekDetailKeys.add(key);
      }
    });
  }

  void _toggleUserGroup(String groupKey) {
    setState(() {
      if (_collapsedUserGroups.contains(groupKey)) {
        _collapsedUserGroups.remove(groupKey);
      } else {
        _collapsedUserGroups.add(groupKey);
      }
    });
  }

  void _expandAllCompletions(List<DietPlanCompletion> items) {
    setState(() {
      _collapsedUserGroups.clear();
      for (final item in items) {
        _expandedCompletionKeys.add(_completionKey(item));
      }
    });
  }

  void _collapseAllCompletions([List<DietPlanCompletion>? items]) {
    final list = items ?? _filteredCompletions;
    setState(() {
      _collapsedUserGroups
        ..clear()
        ..addAll(_groupedCompletions(list).map((e) => e.key));
      _expandedCompletionKeys.clear();
      _expandedWeekDetailKeys.clear();
    });
  }

  /// Keep new groups collapsed by default so the Users list stays compact.
  void _ensureNewGroupsCollapsed(Iterable<DietPlanCompletion> items) {
    for (final key in _groupedCompletions(items.toList()).map((e) => e.key)) {
      // Only seed keys we have never toggled: track known keys separately.
      if (!_knownUserGroupKeys.contains(key)) {
        _knownUserGroupKeys.add(key);
        _collapsedUserGroups.add(key);
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _mainTabs = TabController(length: 2, vsync: this);
    _mainTabs.addListener(_onMainTabChanged);
    _load();
  }

  void _onMainTabChanged() {
    if (_mainTabs.index == 1 && !_mainTabs.indexIsChanging) {
      _loadCompletions();
    }
  }

  @override
  void dispose() {
    _mainTabs.removeListener(_onMainTabChanged);
    _mainTabs.dispose();
    _searchCtrl.dispose();
    _completionSearchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadCompletions() async {
    final showFullLoader = _completions.isEmpty;
    setState(() {
      if (showFullLoader) _completionLoading = true;
      _completionError = '';
    });
    try {
      final data = await _api.getDietPlanCompletions(status: _completionFilter);
      if (!mounted) return;
      setState(() {
        _completions = (data['users'] as List<dynamic>? ?? [])
            .map((u) => DietPlanCompletion.fromJson(Map<String, dynamic>.from(u as Map)))
            .toList();
        _completedCount = (data['completedCount'] as num?)?.toInt() ?? 0;
        _notCompletedCount = (data['notCompletedCount'] as num?)?.toInt() ?? 0;
        _ensureNewGroupsCollapsed(_completions);
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _completionError = ApiService.friendlyError(e);
        });
      }
    } finally {
      if (mounted) setState(() => _completionLoading = false);
    }
  }

  void _refreshCurrentTab() {
    if (_mainTabs.index == 0) {
      _load();
    } else {
      _loadCompletions();
    }
  }

  Future<void> _load({int? page}) async {
    final showFullLoader = _plans.isEmpty;
    setState(() {
      if (showFullLoader) _loading = true;
      _error = '';
      if (page != null) _page = page;
    });
    try {
      final data = await _api.getCoachDietPlans(
        search: _searchCtrl.text.trim(),
        status: _statusFilter,
        assigneeType: _assigneeFilter,
        sort: _sort,
        page: _page,
        limit: 10,
      );
      if (!mounted) return;
      setState(() {
        _plans = (data['plans'] as List<dynamic>? ?? [])
            .map((p) => DietPlan.fromJson(_asJsonMap(p)))
            .toList();
        _totalPages = (data['totalPages'] as num?)?.toInt() ?? 1;
      });
    } catch (e) {
      if (mounted) setState(() { _error = ApiService.friendlyError(e); });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openCreate() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const CoachDietPlanEditorScreen(createMode: true),
      ),
    ).then((saved) async {
      if (saved != true || !mounted) return;
      await _load(page: 1);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Diet plan created and sent successfully.'),
          backgroundColor: CoachDashboardTheme.success,
        ),
      );
    });
  }

  void _openPlan(DietPlan plan, {required bool viewOnly}) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CoachDietPlanEditorScreen(
          planId: plan.id,
          clientId: plan.clientId,
          fitnessClassId: plan.fitnessClassId,
          assigneeName: plan.displayAssigneeName,
          viewOnly: viewOnly,
        ),
      ),
    ).then((saved) async {
      if (saved != true || !mounted) return;
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Diet plan updated and sent successfully.'),
          backgroundColor: CoachDashboardTheme.success,
        ),
      );
    });
  }

  Future<void> _deletePlan(DietPlan plan) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete diet plan?'),
        content: Text('Remove "${plan.title}" for ${plan.displayAssigneeName}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: CoachDashboardTheme.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || plan.id == null) return;
    try {
      await _api.archiveDietPlan(plan.id!);
      if (mounted) {
        setState(() {
          _plans = _plans.where((p) => p.id != plan.id).toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Diet plan deleted.'), backgroundColor: CoachDashboardTheme.success),
        );
      }
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    }
  }

  Future<void> _sendAgain(DietPlan plan) async {
    if (plan.id == null) return;
    try {
      await _api.sendDietPlanAgain(plan.id!);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Diet plan sent again.'), backgroundColor: CoachDashboardTheme.success),
        );
      }
      _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'draft':
        return CoachDashboardTheme.warning;
      case 'completed':
      case 'archived':
        return CoachDashboardTheme.textSecondary;
      default:
        return CoachDashboardTheme.success;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return CoachPage(
      title: 'Diet Plans',
      centerTitle: false,
      actions: [
        TextButton.icon(
          onPressed: _openCreate,
          icon: const Icon(Icons.add_rounded, color: CoachDashboardTheme.primary),
          label: const Text('Create Diet Plan', style: TextStyle(color: CoachDashboardTheme.primary, fontWeight: FontWeight.w600)),
        ),
        IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _refreshCurrentTab),
      ],
      bottom: TabBar(
        controller: _mainTabs,
        labelColor: CoachDashboardTheme.primary,
        indicatorColor: CoachDashboardTheme.primary,
        unselectedLabelColor: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
        tabs: const [
          Tab(text: 'Plans'),
          Tab(text: 'User Completion'),
        ],
      ),
      body: TabBarView(
        controller: _mainTabs,
        children: [
          _buildPlansTab(isDark),
          _buildCompletionTab(isDark),
        ],
      ),
    );
  }

  Widget _buildPlansTab(bool isDark) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            children: [
              TextField(
                controller: _searchCtrl,
                decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Search plans').copyWith(
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.search_rounded),
                    onPressed: () => _load(page: 1),
                  ),
                ),
                onSubmitted: (_) => _load(page: 1),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _filterChip('All', 'all', isDark),
                    _filterChip('Active', 'active', isDark),
                    _filterChip('Draft', 'draft', isDark),
                    _filterChip('History', 'completed', isDark),
                    const SizedBox(width: 8),
                    Container(width: 1, height: 24, color: isDark ? Colors.white24 : Colors.black12),
                    const SizedBox(width: 8),
                    _assigneeChip('Everyone', 'all', isDark),
                    _assigneeChip('By User', 'user', isDark),
                    _assigneeChip('By Group', 'group', isDark),
                    const SizedBox(width: 12),
                    DropdownButton<String>(
                      value: _sort,
                      underline: const SizedBox.shrink(),
                      items: const [
                        DropdownMenuItem(value: 'newest', child: Text('Newest first')),
                        DropdownMenuItem(value: 'oldest', child: Text('Oldest first')),
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        setState(() => _sort = v);
                        _load(page: 1);
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(child: _buildBody(isDark)),
      ],
    );
  }

  List<DietPlanCompletion> get _filteredCompletions {
    final q = _completionQuery.trim().toLowerCase();
    if (q.isEmpty) return _completions;
    return _completions.where((item) {
      final haystack = [
        item.userName,
        item.planName,
        item.groupName ?? '',
        item.statusLabel,
      ].join(' ').toLowerCase();
      return haystack.contains(q);
    }).toList();
  }

  void _onCompletionSearchChanged(String value) {
    setState(() => _completionQuery = value);
  }

  void _clearCompletionSearch() {
    _completionSearchCtrl.clear();
    setState(() => _completionQuery = '');
  }

  Widget _buildCompletionTab(bool isDark) {
    final filtered = _filteredCompletions;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _completionSearchCtrl,
                textInputAction: TextInputAction.search,
                onChanged: _onCompletionSearchChanged,
                decoration: CoachDashboardTheme.fieldDecoration(
                  isDark: isDark,
                  label: 'Search users by name, plan, or group',
                ).copyWith(
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _completionQuery.isNotEmpty
                      ? IconButton(
                          tooltip: 'Clear search',
                          icon: const Icon(Icons.clear_rounded),
                          onPressed: _clearCompletionSearch,
                        )
                      : null,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                _completionQuery.trim().isEmpty
                    ? '$_completedCount completed · $_notCompletedCount pending'
                    : '${filtered.length} result${filtered.length == 1 ? '' : 's'} · $_completedCount completed · $_notCompletedCount pending',
                style: CoachDashboardTheme.bodyMuted(isDark),
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _completionFilterChip('All', 'all', isDark),
                    _completionFilterChip('Completed', 'completed', isDark),
                    _completionFilterChip('Not Completed', 'not_completed', isDark),
                  ],
                ),
              ),
              if (filtered.isNotEmpty) ...[
                const SizedBox(height: 4),
                Builder(
                  builder: (context) {
                    final groups = _groupedCompletions(filtered);
                    final anyGroupExpanded =
                        groups.any((g) => !_collapsedUserGroups.contains(g.key));
                    final canCollapse =
                        anyGroupExpanded || _expandedCompletionKeys.isNotEmpty;
                    return Row(
                      children: [
                        TextButton.icon(
                          onPressed: () => _expandAllCompletions(filtered),
                          icon: const Icon(Icons.unfold_more_rounded, size: 18),
                          label: const Text('Expand all'),
                        ),
                        TextButton.icon(
                          onPressed: canCollapse
                              ? () => _collapseAllCompletions(filtered)
                              : null,
                          icon: const Icon(Icons.unfold_less_rounded, size: 18),
                          label: const Text('Collapse all'),
                        ),
                      ],
                    );
                  },
                ),
              ],
            ],
          ),
        ),
        Expanded(child: _buildCompletionBody(isDark, filtered)),
      ],
    );
  }

  Widget _completionFilterChip(String label, String value, bool isDark) {
    final selected = _completionFilter == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() => _completionFilter = value);
          _loadCompletions();
        },
        selectedColor: CoachDashboardTheme.primary.withValues(alpha: 0.15),
        checkmarkColor: CoachDashboardTheme.primary,
      ),
    );
  }

  Widget _buildCompletionBody(bool isDark, [List<DietPlanCompletion>? items]) {
    final list = items ?? _filteredCompletions;
    if (_completionLoading) {
      return const Center(child: CircularProgressIndicator(color: CoachDashboardTheme.primary));
    }
    if (_completionError.isNotEmpty) {
      return Center(child: Text(_completionError, textAlign: TextAlign.center));
    }
    if (_completions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.people_outline_rounded, size: 48, color: isDark ? Colors.white24 : Colors.grey),
            const SizedBox(height: 12),
            const Text('No assigned users with active diet plans'),
          ],
        ),
      );
    }
    if (list.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off_rounded, size: 48, color: isDark ? Colors.white24 : Colors.grey),
            const SizedBox(height: 12),
            Text(
              'No users match “${_completionQuery.trim()}”',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _clearCompletionSearch,
              child: const Text('Clear search'),
            ),
          ],
        ),
      );
    }

    final groups = _groupedCompletions(list);

    return ListView.builder(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      itemCount: groups.length,
      itemBuilder: (context, i) {
        final entry = groups[i];
        return _userGroupSection(
          groupKey: entry.key,
          users: entry.value,
          isDark: isDark,
        );
      },
    );
  }

  Widget _userGroupSection({
    required String groupKey,
    required List<DietPlanCompletion> users,
    required bool isDark,
  }) {
    final expanded = !_collapsedUserGroups.contains(groupKey);
    final completedInGroup = users.where((u) => u.completed).length;
    final title = _userGroupTitle(groupKey);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: isDark ? Colors.white10 : Colors.grey.shade100,
            borderRadius: BorderRadius.vertical(
              top: const Radius.circular(11),
              bottom: Radius.circular(expanded ? 0 : 11),
            ),
            child: InkWell(
              borderRadius: BorderRadius.vertical(
                top: const Radius.circular(11),
                bottom: Radius.circular(expanded ? 0 : 11),
              ),
              onTap: () => _toggleUserGroup(groupKey),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                child: Row(
                  children: [
                    Icon(
                      groupKey == _individualGroupKey
                          ? Icons.person_outline_rounded
                          : Icons.groups_rounded,
                      color: CoachDashboardTheme.primary,
                      size: 22,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                              color: isDark ? Colors.white : Colors.black87,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            expanded
                                ? '$completedInGroup of ${users.length} completed · tap header to hide users'
                                : '${users.length} user${users.length == 1 ? '' : 's'} · '
                                    '$completedInGroup completed · tap to show users',
                            style: CoachDashboardTheme.bodyMuted(isDark),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                      color: isDark ? Colors.white54 : Colors.black45,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
              child: Column(
                children: [
                  for (final user in users) _completionCard(user, isDark),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _completionStatusRow({
    required DietProgressUiStatus status,
    required String label,
    required bool isDark,
    double fontSize = 13,
  }) {
    final color = _progressStatusColor(status);
    final icon = _progressStatusIcon(status);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: fontSize + 4,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: fontSize,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _progressStatusColor(DietProgressUiStatus status) {
    switch (status) {
      case DietProgressUiStatus.completed:
        return CoachDashboardTheme.success;
      case DietProgressUiStatus.inProgress:
        return CoachDashboardTheme.warning;
      case DietProgressUiStatus.notStarted:
        return CoachDashboardTheme.textSecondary;
    }
  }

  IconData _progressStatusIcon(DietProgressUiStatus status) {
    switch (status) {
      case DietProgressUiStatus.completed:
        return Icons.check_circle;
      case DietProgressUiStatus.inProgress:
        return Icons.timelapse_rounded;
      case DietProgressUiStatus.notStarted:
        return Icons.radio_button_unchecked;
    }
  }

  Widget _completionCard(DietPlanCompletion item, bool isDark) {
    final progressStatus = item.displayProgressStatus;
    final statusColor = _progressStatusColor(progressStatus);
    final key = _completionKey(item);
    final expanded = _expandedCompletionKeys.contains(key);
    final weekExpanded = _expandedWeekDetailKeys.contains(key);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Material(
        color: Colors.transparent,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => _toggleCompletionExpanded(item),
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: statusColor.withValues(alpha: 0.12),
                      child: Icon(
                        _progressStatusIcon(progressStatus),
                        color: statusColor,
                        size: 26,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.userName, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                          Text(item.planName, style: CoachDashboardTheme.bodyMuted(isDark)),
                          if (item.groupName != null)
                            Text('Group: ${item.groupName}', style: CoachDashboardTheme.bodyMuted(isDark)),
                          const SizedBox(height: 2),
                          Text(
                            item.statusLabel,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: statusColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      expanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                      color: isDark ? Colors.white54 : Colors.black45,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Text(
                item.dailyProgressLabel,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: item.completed
                      ? CoachDashboardTheme.success
                      : (isDark ? Colors.white : CoachDashboardTheme.textPrimary),
                ),
              ),
              if (item.isWeekly) ...[
                const SizedBox(height: 4),
                Text(
                  'Today: ${item.todayMealProgressLabel}',
                  style: TextStyle(fontSize: 12, color: isDark ? Colors.white70 : Colors.black87),
                ),
              ],
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: (item.progressPercent / 100).clamp(0.0, 1.0),
                  minHeight: 6,
                  backgroundColor: isDark ? Colors.white12 : Colors.black12,
                  color: statusColor,
                ),
              ),
              const SizedBox(height: 8),
              InkWell(
                onTap: () => _toggleCompletionExpanded(item),
                child: Text(
                  expanded ? 'Hide details' : 'View meal & day details',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: CoachDashboardTheme.primary.withValues(alpha: 0.9),
                  ),
                ),
              ),
              if (expanded) ...[
                const SizedBox(height: 12),
                Divider(height: 1, color: isDark ? Colors.white12 : Colors.black12),
                const SizedBox(height: 12),
                if (item.isWeekly) ...[
                  Text(
                    'Today’s meals',
                    style: CoachDashboardTheme.sectionTitle(isDark),
                  ),
                  const SizedBox(height: 8),
                  if (item.meals.isNotEmpty)
                    ...item.meals.map(
                      (meal) => _completionStatusRow(
                        status: meal.completed
                            ? DietProgressUiStatus.completed
                            : DietProgressUiStatus.notStarted,
                        label: meal.statusText,
                        isDark: isDark,
                      ),
                    )
                  else
                    Text('No meals planned for today.', style: CoachDashboardTheme.bodyMuted(isDark)),
                  const SizedBox(height: 8),
                  _completionStatusRow(
                    status: item.completed
                        ? DietProgressUiStatus.completed
                        : ((item.completedDays ?? 0) > 0
                            ? DietProgressUiStatus.inProgress
                            : DietProgressUiStatus.notStarted),
                    label: item.completed
                        ? 'All 7 days completed'
                        : '${item.completedDays ?? 0} of ${item.daysPlanned ?? 7} days completed',
                    isDark: isDark,
                  ),
                  if (item.weekDays.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Material(
                      color: isDark ? Colors.white10 : Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(8),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(8),
                        onTap: () => _toggleWeekDetailExpanded(item),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'This week (meals per day)',
                                      style: CoachDashboardTheme.sectionTitle(isDark),
                                    ),
                                    Text(
                                      weekExpanded
                                          ? 'Tap to hide day-by-day check-offs'
                                          : 'Tap to open day-by-day check-offs',
                                      style: CoachDashboardTheme.bodyMuted(isDark),
                                    ),
                                  ],
                                ),
                              ),
                              Icon(
                                weekExpanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                                color: isDark ? Colors.white54 : Colors.black45,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    if (weekExpanded) ...[
                      const SizedBox(height: 8),
                      ...item.weekDays.map((day) {
                        final planned = day.mealsPlanned;
                        final done = day.mealsCompleted;
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _completionStatusRow(
                                status: day.dayProgressStatus,
                                label: day.dayStatusLabel(done: done, planned: planned),
                                isDark: isDark,
                              ),
                              if (day.meals.isEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(left: 28, bottom: 2),
                                  child: Text(
                                    'No meals checked yet',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                                    ),
                                  ),
                                )
                              else
                                ...day.meals.map(
                                  (meal) => Padding(
                                    padding: const EdgeInsets.only(left: 28),
                                    child: _completionStatusRow(
                                      status: meal.completed
                                          ? DietProgressUiStatus.completed
                                          : DietProgressUiStatus.notStarted,
                                      label: meal.statusText,
                                      isDark: isDark,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ],
                ] else
                  ...item.meals.map(
                    (meal) => _completionStatusRow(
                      status: meal.completed
                          ? DietProgressUiStatus.completed
                          : DietProgressUiStatus.notStarted,
                      label: meal.statusText,
                      isDark: isDark,
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  item.isWeekly
                      ? 'Week progress: ${item.weeklyAveragePercent}%'
                      : 'Weekly average: ${item.weeklyAveragePercent}%',
                  style: CoachDashboardTheme.bodyMuted(isDark),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () => _toggleCompletionExpanded(item),
                    icon: const Icon(Icons.expand_less_rounded, size: 18),
                    label: const Text('Collapse'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _filterChip(String label, String value, bool isDark) {
    final selected = _statusFilter == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() => _statusFilter = value);
          _load(page: 1);
        },
        selectedColor: CoachDashboardTheme.primary.withValues(alpha: 0.15),
        checkmarkColor: CoachDashboardTheme.primary,
      ),
    );
  }

  Widget _assigneeChip(String label, String value, bool isDark) {
    final selected = _assigneeFilter == value;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) {
          setState(() => _assigneeFilter = value);
          _load(page: 1);
        },
        selectedColor: CoachDashboardTheme.accent.withValues(alpha: 0.15),
        checkmarkColor: CoachDashboardTheme.accent,
      ),
    );
  }

  Widget _buildBody(bool isDark) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: CoachDashboardTheme.primary));
    }
    if (_error.isNotEmpty) {
      return Center(child: Text(_error, textAlign: TextAlign.center));
    }
    if (_plans.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.restaurant_menu_rounded, size: 48, color: isDark ? Colors.white24 : Colors.grey),
              const SizedBox(height: 16),
              Text(
                'No diet plans yet',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Create a plan and assign it to an approved client or class.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.4,
                  color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                style: CoachDashboardTheme.primaryButtonStyle(),
                onPressed: _openCreate,
                icon: const Icon(Icons.add_rounded, color: Colors.white),
                label: const Text('Create Diet Plan', style: TextStyle(color: Colors.white)),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            physics: dashboardScrollPhysics,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            itemCount: _plans.length,
            itemBuilder: (context, i) => _planCard(_plans[i], isDark),
          ),
        ),
        if (_totalPages > 1)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  onPressed: _page > 1 ? () => _load(page: _page - 1) : null,
                  icon: const Icon(Icons.chevron_left_rounded),
                ),
                Text('Page $_page of $_totalPages'),
                IconButton(
                  onPressed: _page < _totalPages ? () => _load(page: _page + 1) : null,
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _planCard(DietPlan plan, bool isDark) {
    final created = plan.createdAt != null ? DateFormat('MMM d, yyyy').format(plan.createdAt!) : '—';
    final statusColor = _statusColor(plan.status);

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        title: Text(plan.title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              plan.isGroupPlan
                  ? 'By Group: ${plan.displayAssigneeName}'
                  : 'By User: ${plan.displayAssigneeName}',
            ),
            Text('Created: $created'),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: CoachDashboardTheme.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: CoachDashboardTheme.primary.withValues(alpha: 0.3)),
                  ),
                  child: Text(
                    plan.planTypeLabel,
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: CoachDashboardTheme.primary),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: statusColor.withValues(alpha: 0.3)),
                  ),
                  child: Text(plan.statusLabel, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: statusColor)),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: (isDark ? Colors.white : Colors.black).withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    plan.isGroupPlan ? 'Group' : 'User',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white70 : Colors.black54,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
        trailing: PopupMenuButton<String>(
          onSelected: (action) {
            switch (action) {
              case 'view':
                _openPlan(plan, viewOnly: true);
              case 'edit':
                _openPlan(plan, viewOnly: false);
              case 'send':
                _sendAgain(plan);
              case 'delete':
                _deletePlan(plan);
            }
          },
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'view', child: Text('View')),
            PopupMenuItem(value: 'edit', child: Text('Edit')),
            PopupMenuItem(value: 'send', child: Text('Send Again')),
            PopupMenuItem(value: 'delete', child: Text('Delete')),
          ],
        ),
        onTap: () => _openPlan(plan, viewOnly: true),
      ),
    );
  }
}

class CoachDietPlanEditorScreen extends StatefulWidget {
  final String? planId;
  final String? clientId;
  final String? fitnessClassId;
  final String? assigneeName;
  final int? memberCount;
  final bool createMode;
  final bool viewOnly;

  const CoachDietPlanEditorScreen({
    super.key,
    this.planId,
    this.clientId,
    this.fitnessClassId,
    this.assigneeName,
    this.memberCount,
    this.createMode = false,
    this.viewOnly = false,
  });

  @override
  State<CoachDietPlanEditorScreen> createState() => _CoachDietPlanEditorScreenState();
}

class _CoachDietPlanEditorScreenState extends State<CoachDietPlanEditorScreen> with SingleTickerProviderStateMixin {
  final ApiService _api = ApiService();
  late TabController _tabs;
  bool _loading = true;
  bool _saving = false;
  DietPlan? _plan;
  DietTodayProgress _todayProgress = const DietTodayProgress();
  int _avgAdherence = 0;
  bool _progressLoading = false;
  List<Map<String, dynamic>> _groupMembers = [];
  List<String> _progressMealTypes = [];
  final Map<String, bool> _progressMealFollowed = {};
  List<Map<String, dynamic>> _clientWeekDays = [];
  int _coachProgressBrowseDay = 0;
  bool _groupMembersExpanded = false;
  final Set<String> _expandedMemberKeys = <String>{};

  String? _selectedClientId;
  String? _selectedClassId;
  String? _selectedAssigneeName;
  List<dynamic> _clients = [];
  List<dynamic> _classes = [];
  String _assigneeType = 'user';

  String? get _clientId => _selectedClientId ?? widget.clientId;
  String? get _fitnessClassId => _selectedClassId ?? widget.fitnessClassId;
  bool get _isGroup => _fitnessClassId != null;

  final _titleCtrl = TextEditingController(text: 'Diet Plan');
  final _caloriesCtrl = TextEditingController(text: '2000');
  final _notesCtrl = TextEditingController();
  String _goal = 'maintenance';
  List<String> _coachSpecializations = const [];
  String _planType = 'single_day'; // single_day | weekly
  int? _singleDayIndex; // single_day: which weekday is checked
  /// Weekly: Monday of the plan week — each day gets a calendar date from this.
  DateTime _weekStartDate = defaultWeekStartForNewPlan();
  /// Weekly: one meal template in bucket 0; which weekdays receive that template.
  final Set<int> _weeklySelectedDays = <int>{};

  final List<_DayMealsBucket> _dayBuckets = List.generate(7, (_) => _DayMealsBucket());
  _DayMealsBucket get _activeBucket => _dayBuckets[0];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: widget.createMode ? 1 : 2, vsync: this);
    _loadCoachSpecialization();
    if (!widget.createMode) {
      _tabs.addListener(_onTabChanged);
    }
    _selectedClientId = widget.clientId;
    _selectedClassId = widget.fitnessClassId;
    _selectedAssigneeName = widget.assigneeName;
    _singleDayIndex = DietDay.mondayBasedDayOfWeek();
    if (_isGroup && widget.assigneeName != null) {
      _titleCtrl.text = '${widget.assigneeName} Diet Plan';
    }
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    if (widget.createMode && widget.clientId == null && widget.fitnessClassId == null) {
      await _loadAssignees();
    }
    await _load();
  }

  Future<void> _loadCoachSpecialization() async {
    try {
      final me = await _api.getMe();
      if (!mounted || me == null) return;
      final specs = coachSpecializationsFromUser(me);
      final goals = allowedDietGoals(specs);
      setState(() {
        _coachSpecializations = specs;
        if (!goals.contains(_goal) && goals.isNotEmpty) {
          _goal = goals.first;
        }
      });
    } catch (_) {}
  }

  Future<void> _loadAssignees() async {
    try {
      final results = await Future.wait([
        _api.getCoachClients(light: true).catchError((_) => <dynamic>[]),
        _api.getCoachClasses().catchError((_) => <dynamic>[]),
      ]).timeout(const Duration(seconds: 30), onTimeout: () => [<dynamic>[], <dynamic>[]]);
      if (mounted) {
        setState(() {
          _clients = results[0] is List ? List<dynamic>.from(results[0] as List) : <dynamic>[];
          _classes = results[1] is List ? List<dynamic>.from(results[1] as List) : <dynamic>[];
        });
      }
    } catch (_) {}
  }

  void _onTabChanged() {
    if (_tabs.index == 1 && !_tabs.indexIsChanging) {
      _refreshProgress();
    }
  }

  void _applyProgressData(Map<String, dynamic>? data) {
    if (data == null) return;
    _avgAdherence = (data['avgAdherence'] as num?)?.toInt() ?? 0;
    final todayJson = data['today'] as Map<String, dynamic>?;
    _todayProgress = DietTodayProgress.fromJson(todayJson);

    final plannedFromApi = (data['plannedMealTypes'] as List<dynamic>?)
            ?.map((e) => e.toString())
            .toList()
        ?? (todayJson?['plannedMealTypes'] as List<dynamic>?)
            ?.map((e) => e.toString())
            .toList()
        ?? const <String>[];
    final plannedFromPlan = _plan?.mealsForDay()
            .where((m) => m.hasContent)
            .map((m) => m.type)
            .toSet()
            .toList()
        ?? const <String>[];
    _progressMealTypes = plannedFromApi.isNotEmpty ? plannedFromApi : plannedFromPlan;

    _progressMealFollowed
      ..clear()
      ..addEntries(
        _todayProgress.mealAdherence.map((entry) {
          final type = entry['type']?.toString() ?? '';
          return MapEntry(type, entry['followed'] == true);
        }).where((e) => e.key.isNotEmpty),
      );

    final members = data['members'] as List<dynamic>? ?? const [];
    _groupMembers = members
        .whereType<Map>()
        .map((m) => Map<String, dynamic>.from(m))
        .toList();

    _clientWeekDays = [];
    final weekCompletion = data['weekCompletion'] as Map<String, dynamic>? ??
        (todayJson?['weekCompletion'] as Map<String, dynamic>?);
    if (weekCompletion != null) {
      for (final day in (weekCompletion['days'] as List<dynamic>? ?? [])) {
        if (day is Map) {
          _clientWeekDays.add(Map<String, dynamic>.from(day));
        }
      }
    }

    if (_plan != null && _todayProgress.targetCalories == 0) {
      final plannedMeals = _progressMealTypes.isNotEmpty
          ? _progressMealTypes.length
          : _plan!.meals.where((m) => m.name.isNotEmpty || m.description.isNotEmpty).length;
      _todayProgress = _todayProgress.copyWith(
        targetCalories: _plan!.dailyCalories,
        mealsPlanned: _todayProgress.mealsPlanned > 0 ? _todayProgress.mealsPlanned : plannedMeals,
      );
    }
  }

  Future<void> _refreshProgress() async {
    if (widget.createMode) return;
    final showFullLoader =
        _progressMealTypes.isEmpty && _groupMembers.isEmpty && _clientWeekDays.isEmpty;
    setState(() {
      if (showFullLoader) _progressLoading = true;
    });
    try {
      if (_plan?.clientId != null) {
        final data = await _api.getClientDietProgress(
          _plan!.clientId!,
          planId: widget.planId ?? _plan?.id,
        );
        if (mounted) setState(() => _applyProgressData(Map<String, dynamic>.from(data as Map)));
      } else if (_plan?.fitnessClassId != null) {
        final data = await _api.getGroupDietProgress(_plan!.fitnessClassId!);
        if (mounted) {
          setState(() {
            _applyProgressData(Map<String, dynamic>.from(data as Map));
            _avgAdherence = (data['avgAdherence'] as num?)?.toInt() ?? _avgAdherence;
          });
        }
      }
    } catch (_) {
    } finally {
      if (mounted) setState(() => _progressLoading = false);
    }
  }

  @override
  void dispose() {
    if (!widget.createMode) {
      _tabs.removeListener(_onTabChanged);
    }
    _tabs.dispose();
    _titleCtrl.dispose();
    _caloriesCtrl.dispose();
    _notesCtrl.dispose();
    for (final bucket in _dayBuckets) {
      bucket.dispose();
    }
    super.dispose();
  }

  void _resetForm() {
    _plan = null;
    _titleCtrl.text = 'Diet Plan';
    _caloriesCtrl.text = '2000';
    _notesCtrl.clear();
    final dietGoals = allowedDietGoals(_coachSpecializations);
    _goal = dietGoals.isNotEmpty ? dietGoals.first : 'maintenance';
    _planType = 'single_day';
    _weeklySelectedDays.clear();
    _singleDayIndex = DietDay.mondayBasedDayOfWeek();
    for (final bucket in _dayBuckets) {
      bucket.clear();
    }
    if (!widget.createMode) return;
    setState(() {
      _selectedClientId = null;
      _selectedClassId = null;
      _selectedAssigneeName = null;
      _assigneeType = 'user';
    });
  }

  Future<void> _load() async {
    if (widget.planId != null) {
      final showFullLoader = _plan == null;
      if (showFullLoader) setState(() => _loading = true);
      try {
        final planJson = await _api.getDietPlanById(widget.planId!);
        _plan = DietPlan.fromJson(planJson);
        _applyPlan(_plan!);
        if (!widget.createMode && _plan!.clientId != null) {
          final progressData = await _api.getClientDietProgress(
            _plan!.clientId!,
            planId: widget.planId ?? _plan!.id,
          );
          _applyProgressData(Map<String, dynamic>.from(progressData as Map));
        } else if (!widget.createMode && _plan!.fitnessClassId != null) {
          final progressData = await _api.getGroupDietProgress(_plan!.fitnessClassId!);
          _applyProgressData(Map<String, dynamic>.from(progressData as Map));
        }
      } catch (_) {
      } finally {
        if (mounted) setState(() => _loading = false);
      }
      return;
    }

    if (_clientId == null && _fitnessClassId == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }

    final showFullLoader = _plan == null;
    if (showFullLoader) setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _isGroup
            ? _api.getGroupDietPlan(_fitnessClassId!)
            : _api.getClientDietPlan(_clientId!),
        _isGroup
            ? _api.getGroupDietProgress(_fitnessClassId!)
            : _api.getClientDietProgress(_clientId!, planId: _plan?.id),
      ]);
      final planJson = results[0];
      final progressJson = results[1] as Map<String, dynamic>;
      if (planJson != null) {
        _plan = DietPlan.fromJson(planJson);
        _applyPlan(_plan!);
      }
      _applyProgressData(progressJson);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applyPlan(DietPlan plan) {
    _titleCtrl.text = plan.title;
    _caloriesCtrl.text = '${plan.dailyCalories}';
    _notesCtrl.text = plan.notes;
    _goal = plan.goal;
    _planType = plan.isWeekly ? 'weekly' : 'single_day';
    _weeklySelectedDays.clear();
    _singleDayIndex = plan.targetDayOfWeek ?? DietDay.mondayBasedDayOfWeek();
    if (plan.weekStartDate != null) {
      _weekStartDate = dateOnly(mondayOf(plan.weekStartDate!));
    } else {
      _weekStartDate = defaultWeekStartForNewPlan();
    }
    for (final bucket in _dayBuckets) {
      bucket.clear();
    }
    if (plan.isWeekly) {
      DietDay? templateDay;
      for (final day in plan.days) {
        if (day.meals.any((m) => m.hasContent)) {
          templateDay ??= day;
          _weeklySelectedDays.add(day.dayOfWeek.clamp(0, 6));
        }
      }
      if (templateDay != null) {
        _dayBuckets[0].loadFromMeals(templateDay.meals);
      } else if (plan.meals.any((m) => m.hasContent)) {
        _dayBuckets[0].loadFromMeals(plan.meals);
      }
      if (_weeklySelectedDays.isEmpty) {
        _weeklySelectedDays.addAll(List.generate(7, (i) => i));
      }
    } else {
      _dayBuckets[0].loadFromMeals(plan.meals);
    }
  }

  Future<void> _pickWeekStartDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: dateOnly(_weekStartDate),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365 * 2)),
      helpText: 'Select weekly plan start date',
    );
    if (picked == null || !mounted) return;
    setState(() => _weekStartDate = dateOnly(mondayOf(picked)));
  }

  void _togglePlanType(String type) {
    if (_planType == type) return;
    setState(() {
      _planType = type;
      final today = DietDay.mondayBasedDayOfWeek();
      if (type == 'weekly') {
        _weekStartDate = defaultWeekStartForNewPlan();
        if (_weeklySelectedDays.isEmpty) {
          _weeklySelectedDays.addAll(List.generate(7, (i) => i));
        }
      } else {
        _singleDayIndex ??= today;
      }
    });
  }

  void _setSingleDay(int dayIndex) {
    setState(() => _singleDayIndex = dayIndex);
  }

  bool get _allWeeklyDaysSelected => _weeklySelectedDays.length == 7;

  void _selectAllWeeklyDays() {
    setState(() => _weeklySelectedDays.addAll(List.generate(7, (i) => i)));
  }

  void _clearAllWeeklyDays() {
    setState(() => _weeklySelectedDays.clear());
  }

  void _toggleWeeklyDay(int dayIndex, bool selected) {
    setState(() {
      if (selected) {
        _weeklySelectedDays.add(dayIndex);
      } else {
        _weeklySelectedDays.remove(dayIndex);
      }
    });
  }

  bool get _weeklyTemplateComplete => _dayBuckets[0].isCompleteForWeeklyPlan;

  List<String> get _weeklyTemplateMissing => _dayBuckets[0].missingWeeklySections();

  Future<bool> _confirmWeeklyValidationIssues() async {
    if (!mounted) return false;
    final issues = <String>[];
    if (!_weeklyTemplateComplete) {
      issues.add('Meals: add ${_weeklyTemplateMissing.join(', ')}.');
    }
    final missingTimes = _dayBuckets[0].missingMealTimes();
    if (missingTimes.isNotEmpty) {
      issues.add('Meal times required for reminders: ${missingTimes.join(', ')}.');
    }
    if (_weeklySelectedDays.length < 7) {
      issues.add('Select all seven days (Monday–Sunday) before sending. Use Select All Days.');
    }
    if (issues.isEmpty) return true;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Weekly plan incomplete'),
        content: Text(issues.join('\n\n')),
        actions: [
          FilledButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
        ],
      ),
    );
    return false;
  }

  bool _isPresetSnackSelected(String name) {
    return _activeBucket.snackForms.any((f) => f.name.text.trim() == name);
  }

  List<_MealForm> get _customSnackForms {
    return _activeBucket.snackForms.where((f) => !_snackOptions.contains(f.name.text.trim())).toList();
  }

  void _togglePresetSnack(String name, bool selected) {
    setState(() {
      final bucket = _activeBucket;
      if (selected) {
        if (!bucket.snackForms.any((f) => f.name.text.trim() == name)) {
          final form = _MealForm();
          form.name.text = name;
          bucket.snackForms.add(form);
        }
      } else {
        final index = bucket.snackForms.indexWhere((f) => f.name.text.trim() == name);
        if (index != -1) {
          bucket.snackForms[index].dispose();
          bucket.snackForms.removeAt(index);
        }
      }
    });
  }

  void _addSnack({String? presetName}) {
    setState(() {
      final form = _MealForm();
      if (presetName != null) form.name.text = presetName;
      _activeBucket.snackForms.add(form);
    });
  }

  void _removeSnack(_MealForm form) {
    setState(() {
      final list = _activeBucket.snackForms;
      final index = list.indexOf(form);
      if (index == -1) return;
      list[index].dispose();
      list.removeAt(index);
    });
  }

  bool get _hasAssignee => _clientId != null || _fitnessClassId != null;

  void _onWeeklyMealFieldEdited() {
    if (_planType == 'weekly') setState(() {});
  }

  Future<void> _save({required String status, bool confirmSupersede = false}) async {
    if (!_hasAssignee) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select a user or group first.'), backgroundColor: CoachDashboardTheme.warning),
      );
      return;
    }

    final calories = int.tryParse(_caloriesCtrl.text.trim());
    if (calories == null || calories < 1 || calories > 20000) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Daily calories must be a positive number (1–20000).'),
          backgroundColor: CoachDashboardTheme.warning,
        ),
      );
      return;
    }

    if (status == 'active') {
      final missingTimes = _activeBucket.missingMealTimes();
      if (missingTimes.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Set a Meal Time for: ${missingTimes.join(', ')}. Reminders fire at that time.'),
            backgroundColor: CoachDashboardTheme.warning,
          ),
        );
        return;
      }
    }

    setState(() => _saving = true);
    try {
      final payload = <String, dynamic>{
        if (_plan?.id != null) 'planId': _plan!.id,
        if (_isGroup) 'fitnessClassId': _fitnessClassId,
        if (!_isGroup) 'clientId': _clientId,
        'title': _titleCtrl.text.trim(),
        'goal': _goal,
        'planType': _planType,
        'dailyCalories': calories,
        'notes': _notesCtrl.text.trim(),
        'status': status,
        if (confirmSupersede) 'confirmSupersede': true,
      };
      if (_planType == 'weekly') {
        if (!await _confirmWeeklyValidationIssues()) {
          setState(() => _saving = false);
          return;
        }
        final weekStart = dateOnly(mondayOf(_weekStartDate));
        final templateMeals = _dayBuckets[0].buildMeals().map((m) => m.toJson()).toList();
        final daysPayload = <Map<String, dynamic>>[];
        for (var i = 0; i < 7; i++) {
          final dayDate = weekDayDate(weekStart, i);
          daysPayload.add({
            'dayOfWeek': i,
            'date': formatDateOnly(dayDate),
            'meals': _weeklySelectedDays.contains(i) ? templateMeals : <Map<String, dynamic>>[],
          });
        }
        payload['days'] = daysPayload;
        payload['meals'] = templateMeals;
        payload['planType'] = 'weekly';
        payload['weekStartDate'] = formatDateOnly(weekStart);
      } else {
        if (_singleDayIndex == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Check one day for the single-day plan.'),
              backgroundColor: CoachDashboardTheme.warning,
            ),
          );
          setState(() => _saving = false);
          return;
        }
        payload['targetDayOfWeek'] = _singleDayIndex;
        payload['meals'] = _dayBuckets[0].buildMeals().map((m) => m.toJson()).toList();
      }
      await _api.createDietPlan(payload);
      if (!mounted) return;

      final sent = status == 'active';

      // Create/Send and Save/Send: close editor and let the list refresh + toast.
      if (sent && (widget.createMode || widget.planId != null)) {
        Navigator.pop(context, true);
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Draft saved.'),
          backgroundColor: CoachDashboardTheme.success,
        ),
      );
      // Stop Save spinner immediately; sync editor state in background.
      if (mounted) setState(() => _saving = false);
      _load();
    } on ApiConflictException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      final existingTitle = e.body?['existingPlan'] is Map
          ? (e.body!['existingPlan']['title']?.toString() ?? 'current plan')
          : 'current plan';
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Replace active plan?'),
          content: Text(
            'This assignee already has an active diet plan (“$existingTitle”). '
            'Move it to history and activate this new plan?',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Replace')),
          ],
        ),
      );
      if (ok == true) {
        await _save(status: status, confirmSupersede: true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _sendReminders() async {
    final clientId = _clientId;
    final classId = _fitnessClassId;
    if (clientId == null && classId == null) return;
    try {
      final res = classId != null
          ? await _api.sendGroupMealReminders(classId)
          : await _api.sendMealReminders(clientId!);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message']?.toString() ?? 'Reminders sent'), backgroundColor: CoachDashboardTheme.success),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final title = widget.createMode
        ? 'Create Diet Plan'
        : (widget.assigneeName ?? _selectedAssigneeName ?? 'Diet Plan');
    final readOnly = widget.viewOnly;

    return CoachPage(
      title: title,
      bottom: widget.createMode
          ? null
          : TabBar(
              controller: _tabs,
              labelColor: CoachDashboardTheme.primary,
              indicatorColor: CoachDashboardTheme.primary,
              unselectedLabelColor: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
              tabs: const [Tab(text: 'Plan'), Tab(text: 'Progress')],
            ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : widget.createMode
              ? _buildPlanForm(isDark, readOnly: readOnly)
              : TabBarView(
                  controller: _tabs,
                  children: [
                    _buildPlanForm(isDark, readOnly: readOnly),
                    _buildProgressTab(isDark),
                  ],
                ),
    );
  }

  Widget _buildAssigneePicker(bool isDark, {required bool readOnly}) {
    if (!widget.createMode || (widget.clientId != null || widget.fitnessClassId != null)) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Assign To', style: CoachDashboardTheme.sectionTitle(isDark)),
        const SizedBox(height: 4),
        Text(
          'Create a personal plan for one client, or one plan for an entire group.',
          style: CoachDashboardTheme.bodyMuted(isDark),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'user', label: Text('By User'), icon: Icon(Icons.person_outline_rounded)),
            ButtonSegment(value: 'group', label: Text('By Group'), icon: Icon(Icons.groups_outlined)),
          ],
          selected: {_assigneeType},
          onSelectionChanged: readOnly
              ? null
              : (selection) => setState(() {
                    _assigneeType = selection.first;
                    _selectedClientId = null;
                    _selectedClassId = null;
                    _selectedAssigneeName = null;
                  }),
        ),
        const SizedBox(height: 10),
        if (_assigneeType == 'user')
          DropdownButtonFormField<String>(
            value: _selectedClientId,
            decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Select Client'),
            items: _clients.map((c) {
              final id = c['user']?['_id']?.toString() ?? '';
              final userMap = c['user'] is Map ? Map<dynamic, dynamic>.from(c['user'] as Map) : null;
              final name = ApiService.displayName(userMap, fallback: 'Client');
              return DropdownMenuItem(value: id, child: Text(name));
            }).toList(),
            onChanged: readOnly
                ? null
                : (v) => setState(() {
                      _selectedClientId = v;
                      final match = _clients
                          .map((c) => c['user'])
                          .whereType<Map>()
                          .cast<Map>()
                          .where((u) => u['_id']?.toString() == v)
                          .toList();
                      _selectedAssigneeName = match.isEmpty
                          ? 'Client'
                          : ApiService.displayName(
                              Map<dynamic, dynamic>.from(match.first),
                              fallback: 'Client',
                            );
                    }),
          )
        else
          DropdownButtonFormField<String>(
            value: _selectedClassId,
            decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Select Group'),
            items: _classes.map((cls) {
              final id = cls['_id']?.toString() ?? '';
              final name = cls['title']?.toString() ?? 'Group';
              final count = cls['enrolledCount'] as int? ?? (cls['enrolledStudents'] as List?)?.length ?? 0;
              return DropdownMenuItem(value: id, child: Text('$name ($count members)'));
            }).toList(),
            onChanged: readOnly
                ? null
                : (v) => setState(() {
                      _selectedClassId = v;
                      _selectedAssigneeName = _classes
                          .firstWhere((cls) => cls['_id']?.toString() == v, orElse: () => {'title': 'Group'})['title']
                          ?.toString();
                      if (_selectedAssigneeName != null) {
                        _titleCtrl.text = '$_selectedAssigneeName Diet Plan';
                      }
                    }),
          ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildPlanForm(bool isDark, {required bool readOnly}) {
    return ListView(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.all(18),
      children: [
        _coachFormSectionHeader(
          isDark,
          step: '1',
          title: 'Basics',
          subtitle: 'Who this plan is for and daily targets',
        ),
        _buildAssigneePicker(isDark, readOnly: readOnly),
        if (_isGroup && widget.memberCount != null)
          Container(
            margin: const EdgeInsets.only(bottom: 14),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: CoachDashboardTheme.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text('This plan applies to all ${widget.memberCount} members in ${widget.assigneeName}.'),
          ),
        TextField(
          controller: _titleCtrl,
          readOnly: readOnly,
          decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Plan Title'),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: allowedDietGoals(_coachSpecializations).contains(_goal)
              ? _goal
              : (allowedDietGoals(_coachSpecializations).isNotEmpty
                  ? allowedDietGoals(_coachSpecializations).first
                  : null),
          decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Goal'),
          items: [
            if (allowedDietGoals(_coachSpecializations).contains('weight_loss'))
              const DropdownMenuItem(value: 'weight_loss', child: Text('Weight Loss')),
            if (allowedDietGoals(_coachSpecializations).contains('muscle_gain'))
              const DropdownMenuItem(value: 'muscle_gain', child: Text('Muscle Gain')),
            if (allowedDietGoals(_coachSpecializations).contains('maintenance'))
              const DropdownMenuItem(value: 'maintenance', child: Text('Maintenance')),
          ],
          onChanged: readOnly
              ? null
              : (v) => setState(() {
                    final goals = allowedDietGoals(_coachSpecializations);
                    _goal = v ?? (goals.isNotEmpty ? goals.first : 'maintenance');
                  }),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _caloriesCtrl,
          readOnly: readOnly,
          keyboardType: TextInputType.number,
          decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Daily Calories'),
        ),
        const SizedBox(height: 20),
        _coachFormSectionHeader(
          isDark,
          step: '2',
          title: 'Plan type',
          subtitle: 'Single day or one weekly meal set',
        ),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: isDark ? Colors.white12 : Colors.grey.shade300),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            children: [
              CheckboxListTile(
                dense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                controlAffinity: ListTileControlAffinity.leading,
                activeColor: CoachDashboardTheme.primary,
                value: _planType == 'single_day',
                title: const Text('Single Day Diet Plan', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                subtitle: const Text('Check one day, then set Breakfast, Lunch, Dinner & Snacks', style: TextStyle(fontSize: 12)),
                onChanged: readOnly
                    ? null
                    : (v) {
                        if (v == true) _togglePlanType('single_day');
                      },
              ),
              Divider(height: 1, color: isDark ? Colors.white10 : Colors.grey.shade200),
              CheckboxListTile(
                dense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                controlAffinity: ListTileControlAffinity.leading,
                activeColor: CoachDashboardTheme.primary,
                value: _planType == 'weekly',
                title: const Text('Weekly Diet Plan', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                subtitle: const Text('Create meals once, then choose which days (Mon–Sun) get this plan', style: TextStyle(fontSize: 12)),
                onChanged: readOnly
                    ? null
                    : (v) {
                        if (v == true) _togglePlanType('weekly');
                      },
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (_planType == 'single_day') ...[
          Text('Day of the week', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 4),
          Text(
            'Check the day this plan applies to.',
            style: CoachDashboardTheme.bodyMuted(isDark),
          ),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: isDark ? Colors.white12 : Colors.grey.shade300),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                for (var i = 0; i < 7; i++) ...[
                  if (i > 0) Divider(height: 1, color: isDark ? Colors.white10 : Colors.grey.shade200),
                  CheckboxListTile(
                    dense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    controlAffinity: ListTileControlAffinity.leading,
                    activeColor: CoachDashboardTheme.primary,
                    value: _singleDayIndex == i,
                    title: Text(
                      DietDay.dayNames[i],
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: _singleDayIndex == i ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    subtitle: Text(
                      _singleDayIndex == i ? 'Selected day' : 'Tap to select',
                      style: TextStyle(fontSize: 11, color: isDark ? Colors.white54 : Colors.grey),
                    ),
                    onChanged: readOnly
                        ? null
                        : (v) {
                            if (v == true) _setSingleDay(i);
                          },
                  ),
                ],
              ],
            ),
          ),
          if (_singleDayIndex != null) ...[
            const SizedBox(height: 12),
            Text(
              'Meals for ${DietDay.dayNames[_singleDayIndex!]}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: CoachDashboardTheme.primary),
            ),
          ],
        ],
        if (_planType == 'weekly') ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.12 : 0.07),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: CoachDashboardTheme.primary.withValues(alpha: 0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'One weekly meal set',
                  style: TextStyle(fontWeight: FontWeight.w800, color: CoachDashboardTheme.primary),
                ),
                const SizedBox(height: 6),
                Text(
                  'Add Breakfast, Lunch, Dinner, and Snacks once. Then choose which days get this same plan. '
                  'One save creates a single Weekly Diet Plan (not separate daily plans).',
                  style: TextStyle(fontSize: 12, height: 1.35, color: isDark ? Colors.white70 : Colors.black87),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _coachFormSectionHeader(
            isDark,
            step: '2b',
            title: 'Start date',
            subtitle: 'Week runs Monday–Sunday from the selected start',
          ),
          OutlinedButton.icon(
            onPressed: readOnly ? null : _pickWeekStartDate,
            icon: const Icon(Icons.calendar_month_rounded),
            label: Text('Week of ${formatWeekRange(_weekStartDate)}'),
          ),
          const SizedBox(height: 6),
          Text(
            'Dates are assigned automatically: Mon–Sun for this week.',
            style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : Colors.black54),
          ),
        ],
        if ((_planType == 'single_day' && _singleDayIndex != null) || _planType == 'weekly') ...[
          const SizedBox(height: 16),
          _coachFormSectionHeader(
            isDark,
            step: '3',
            title: 'Meals',
            subtitle: 'Expand Breakfast, Lunch, Dinner & Snacks to fill details',
          ),
          if (_planType == 'weekly') ...[
            Text(
              _weeklyTemplateComplete
                  ? 'Meals complete — assign to days below.'
                  : 'Missing: ${_weeklyTemplateMissing.join(', ')}',
              style: TextStyle(
                fontSize: 12,
                color: _weeklyTemplateComplete ? CoachDashboardTheme.success : CoachDashboardTheme.warning,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
          ],
          ..._activeBucket.mealForms.entries.map((e) => _MealSection(
                label: e.key,
                form: e.value,
                isDark: isDark,
                readOnly: readOnly,
                onEdited: _planType == 'weekly' && !readOnly ? _onWeeklyMealFieldEdited : null,
              )),
          _SnacksListSection(
            snackForms: _activeBucket.snackForms,
            customSnackForms: _customSnackForms,
            isDark: isDark,
            readOnly: readOnly,
            isPresetSelected: _isPresetSnackSelected,
            onTogglePreset: _togglePresetSnack,
            onAdd: _addSnack,
            onRemove: _removeSnack,
          ),
        ],
        if (_planType == 'weekly') ...[
          const SizedBox(height: 16),
          _coachFormSectionHeader(
            isDark,
            step: '4',
            title: 'Assign to days',
            subtitle: 'Same meals apply to every day you check',
          ),
          if (!readOnly)
            Row(
              children: [
                TextButton.icon(
                  onPressed: _allWeeklyDaysSelected ? null : _selectAllWeeklyDays,
                  icon: const Icon(Icons.done_all_rounded, size: 18),
                  label: const Text('Select All Days'),
                ),
                TextButton(
                  onPressed: _weeklySelectedDays.isEmpty ? null : _clearAllWeeklyDays,
                  child: const Text('Clear all'),
                ),
                const Spacer(),
                Text(
                  '${_weeklySelectedDays.length} / 7 selected',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: _weeklySelectedDays.isEmpty
                        ? CoachDashboardTheme.warning
                        : CoachDashboardTheme.primary,
                  ),
                ),
              ],
            ),
          const SizedBox(height: 4),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: isDark ? Colors.white12 : Colors.grey.shade300),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                for (var i = 0; i < 7; i++) ...[
                  if (i > 0) Divider(height: 1, color: isDark ? Colors.white10 : Colors.grey.shade200),
                  CheckboxListTile(
                    dense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    controlAffinity: ListTileControlAffinity.leading,
                    activeColor: CoachDashboardTheme.primary,
                    value: _weeklySelectedDays.contains(i),
                    title: Text(
                      '${DietDay.dayNames[i]} — ${DateFormat('MMMM d').format(weekDayDate(_weekStartDate, i))}',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: _weeklySelectedDays.contains(i) ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    subtitle: Text(
                      _weeklySelectedDays.contains(i)
                          ? 'Same meals as weekly template'
                          : 'Not assigned',
                      style: TextStyle(fontSize: 11, color: isDark ? Colors.white54 : Colors.grey),
                    ),
                    onChanged: readOnly
                        ? null
                        : (v) => _toggleWeeklyDay(i, v ?? false),
                  ),
                ],
              ],
            ),
          ),
        ],
        if (!readOnly) ...[
          const SizedBox(height: 20),
          _coachFormSectionHeader(
            isDark,
            step: null,
            title: 'Save & send',
            subtitle: 'Save as draft or send the plan to the assignee',
          ),
          const SizedBox(height: 20),
          if (_planType == 'weekly' && (!_weeklyTemplateComplete || !_allWeeklyDaysSelected)) ...[
            Text(
              'Complete Breakfast, Lunch, Dinner & Snacks, then select all seven days (or Select All Days) before sending.',
              style: TextStyle(
                fontSize: 12,
                color: CoachDashboardTheme.warning.withValues(alpha: 0.95),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
          ],
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: CoachDashboardTheme.primaryButtonStyle(),
              onPressed: (_saving ||
                      (_planType == 'weekly' &&
                          (!_weeklyTemplateComplete || !_allWeeklyDaysSelected)))
                  ? null
                  : () => _save(status: 'active'),
              child: _saving
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(widget.createMode ? 'Create & Send Plan' : 'Save & Send Plan'),
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _saving ? null : () => _save(status: 'draft'),
            child: const Text('Save as Draft'),
          ),
          if (!widget.createMode) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _sendReminders,
              icon: const Icon(Icons.alarm_rounded),
              label: Text(_isGroup ? 'Send Reminders to Group' : 'Send Meal Reminders'),
            ),
          ],
        ],
      ],
    );
  }

  Widget _coachFormSectionHeader(
    bool isDark, {
    required String? step,
    required String title,
    String? subtitle,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (step != null) ...[
            Container(
              width: 24,
              height: 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: CoachDashboardTheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                step,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: CoachDashboardTheme.primary,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: isDark ? Colors.white : Colors.black87,
                  ),
                ),
                if (subtitle != null && subtitle.isNotEmpty)
                  Text(subtitle, style: CoachDashboardTheme.bodyMuted(isDark)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildProgressTab(bool isDark) {
    if (_progressLoading) {
      return const Center(child: CircularProgressIndicator(color: CoachDashboardTheme.primary));
    }

    final mealFollowed = Map<String, bool>.from(_progressMealFollowed);
    if (mealFollowed.isEmpty) {
      for (final entry in _todayProgress.mealAdherence) {
        final type = entry['type']?.toString() ?? '';
        if (type.isNotEmpty) mealFollowed[type] = entry['followed'] == true;
      }
    }

    var progressMealTypes = List<String>.from(_progressMealTypes);

    if (_plan?.isWeekly == true && _clientWeekDays.isNotEmpty) {
      final dayRow = _clientWeekDays.cast<Map<String, dynamic>?>().firstWhere(
            (d) => (d?['dayOfWeek'] as num?)?.toInt() == _coachProgressBrowseDay,
            orElse: () => _clientWeekDays.isNotEmpty ? _clientWeekDays.first : null,
          );
      final adherence = (dayRow?['mealAdherence'] as List<dynamic>? ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();
      mealFollowed.clear();
      for (final row in adherence) {
        final type = row['type']?.toString();
        if (type != null && type.isNotEmpty) {
          mealFollowed[type] = row['followed'] == true;
        }
      }
      const order = ['breakfast', 'lunch', 'dinner', 'snacks'];
      final plannedFromDay = _plan!.mealsForDay(_coachProgressBrowseDay)
          .where((m) => m.hasContent)
          .map((m) => m.type)
          .toSet();
      if (plannedFromDay.isNotEmpty) {
        progressMealTypes = order.where(plannedFromDay.contains).toList();
      }
    }

    final planned = progressMealTypes.isNotEmpty
        ? progressMealTypes.length
        : _todayProgress.mealsPlanned;
    final completed = mealFollowed.values.where((v) => v).length;
    final pct = planned > 0 ? ((completed / planned) * 100).round() : 0;
    final progressToday = _todayProgress.copyWith(
      mealsCompleted: completed,
      mealsPlanned: planned,
      dailyGoalPercent: pct,
      adherencePercent: pct,
      followedPlan: planned > 0 && completed == planned,
      hasActivity: _todayProgress.hasActivity || completed > 0,
    );

    return DietProgressPanel(
      today: progressToday,
      avgAdherence: _avgAdherence,
      mealTypes: _groupMembers.isEmpty ? progressMealTypes : const [],
      mealFollowed: mealFollowed,
      isDark: isDark,
      onRefresh: _refreshProgress,
      progressTitle: _plan?.isWeekly == true
          ? 'Client meals · ${DietDay.dayNames[_coachProgressBrowseDay.clamp(0, 6)]}'
          : 'Client meal progress · today',
      footer: [
        if (_plan?.isWeekly == true && _clientWeekDays.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('This week (live)', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (var i = 0; i < 7; i++) ...[
                  if (i > 0) const SizedBox(width: 8),
                  FilterChip(
                    selected: _coachProgressBrowseDay == i,
                    label: Text(DietDay.dayNames[i].substring(0, 3)),
                    onSelected: (_) => setState(() => _coachProgressBrowseDay = i),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          ...List.generate(7, (i) {
            final day = _clientWeekDays.cast<Map<String, dynamic>?>().firstWhere(
                  (d) => (d?['dayOfWeek'] as num?)?.toInt() == i,
                  orElse: () => null,
                );
            final meals = (day?['mealAdherence'] as List<dynamic>? ?? [])
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList();
            final plannedTypes = _plan?.mealsForDay(i).where((m) => m.hasContent).map((m) => m.type).toSet() ?? {};
            if (plannedTypes.isEmpty) return const SizedBox.shrink();
            final done = meals.where((m) => m['followed'] == true).length;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: CoachDashboardTheme.cardDecoration(isDark),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${DietDay.dayNames[i]} · $done/${plannedTypes.length} meals',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    ...plannedTypes.map((type) {
                      final match = meals.cast<Map<String, dynamic>?>().firstWhere(
                            (m) => m?['type']?.toString() == type,
                            orElse: () => null,
                          );
                      final label = switch (type) {
                        'breakfast' => 'Breakfast',
                        'lunch' => 'Lunch',
                        'dinner' => 'Dinner',
                        _ => 'Snacks',
                      };
                      final followed = match?['followed'] == true;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Row(
                          children: [
                            Icon(
                              followed ? Icons.check_circle : Icons.cancel,
                              size: 16,
                              color: followed
                                  ? CoachDashboardTheme.success
                                  : CoachDashboardTheme.danger,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              followed ? '$label Completed' : '$label Not Completed',
                              style: TextStyle(
                                color: followed
                                    ? CoachDashboardTheme.success
                                    : CoachDashboardTheme.danger,
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
            );
          }),
        ],
        if (_groupMembers.isNotEmpty) ...[
          const SizedBox(height: 16),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Material(
                  color: isDark ? Colors.white10 : Colors.grey.shade100,
                  borderRadius: BorderRadius.vertical(
                    top: const Radius.circular(11),
                    bottom: Radius.circular(_groupMembersExpanded ? 0 : 11),
                  ),
                  child: InkWell(
                    borderRadius: BorderRadius.vertical(
                      top: const Radius.circular(11),
                      bottom: Radius.circular(_groupMembersExpanded ? 0 : 11),
                    ),
                    onTap: () => setState(() => _groupMembersExpanded = !_groupMembersExpanded),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                      child: Row(
                        children: [
                          const Icon(Icons.groups_rounded, color: CoachDashboardTheme.primary, size: 22),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Users · ${widget.assigneeName ?? _selectedAssigneeName ?? 'Group'}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 15,
                                    color: isDark ? Colors.white : Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _groupMembersExpanded
                                      ? '${_groupMembers.length} members · tap to hide'
                                      : '${_groupMembers.length} members · tap to show meal completion',
                                  style: CoachDashboardTheme.bodyMuted(isDark),
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            _groupMembersExpanded
                                ? Icons.expand_less_rounded
                                : Icons.expand_more_rounded,
                            color: isDark ? Colors.white54 : Colors.black45,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                if (_groupMembersExpanded)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
                    child: Column(
                      children: [
                        ..._groupMembers.map((member) {
                          final name = member['name']?.toString() ?? 'Member';
                          final memberKey = member['userId']?.toString() ?? name;
                          final memberExpanded = _expandedMemberKeys.contains(memberKey);
                          final meals = (member['mealAdherence'] as List<dynamic>? ?? const [])
                              .whereType<Map>()
                              .map((m) => Map<String, dynamic>.from(m))
                              .toList();
                          final planned = _progressMealTypes.isNotEmpty
                              ? _progressMealTypes
                              : meals
                                  .map((m) => m['type']?.toString() ?? '')
                                  .where((t) => t.isNotEmpty)
                                  .toList();
                          final doneCount = planned.where((type) {
                            final match = meals.cast<Map<String, dynamic>?>().firstWhere(
                                  (m) => m?['type']?.toString() == type,
                                  orElse: () => null,
                                );
                            return match?['followed'] == true;
                          }).length;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            decoration: CoachDashboardTheme.cardDecoration(isDark),
                            child: Material(
                              color: Colors.transparent,
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () {
                                  setState(() {
                                    if (memberExpanded) {
                                      _expandedMemberKeys.remove(memberKey);
                                    } else {
                                      _expandedMemberKeys.add(memberKey);
                                    }
                                  });
                                },
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
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
                                          Text(
                                            planned.isEmpty
                                                ? 'No meals'
                                                : '$doneCount/${planned.length} meals',
                                            style: CoachDashboardTheme.bodyMuted(isDark),
                                          ),
                                          const SizedBox(width: 6),
                                          Icon(
                                            memberExpanded
                                                ? Icons.expand_less_rounded
                                                : Icons.expand_more_rounded,
                                            size: 20,
                                            color: isDark ? Colors.white54 : Colors.black45,
                                          ),
                                        ],
                                      ),
                                      if (memberExpanded) ...[
                                        const SizedBox(height: 8),
                                        if (planned.isEmpty)
                                          Text(
                                            'No meals planned for today.',
                                            style: TextStyle(
                                              fontSize: 12,
                                              color: isDark ? Colors.white54 : Colors.grey,
                                            ),
                                          )
                                        else
                                          ...planned.map((type) {
                                            final match = meals.cast<Map<String, dynamic>?>().firstWhere(
                                                  (m) => m?['type']?.toString() == type,
                                                  orElse: () => null,
                                                );
                                            final done = match?['followed'] == true;
                                            final label = switch (type) {
                                              'breakfast' => 'Breakfast',
                                              'lunch' => 'Lunch',
                                              'dinner' => 'Dinner',
                                              _ => 'Snacks',
                                            };
                                            return Padding(
                                              padding: const EdgeInsets.only(bottom: 4),
                                              child: Row(
                                                children: [
                                                  Icon(
                                                    done ? Icons.check_circle : Icons.cancel,
                                                    size: 16,
                                                    color: done
                                                        ? CoachDashboardTheme.success
                                                        : CoachDashboardTheme.danger,
                                                  ),
                                                  const SizedBox(width: 6),
                                                  Text(
                                                    done ? '$label Completed' : '$label Not Completed',
                                                    style: TextStyle(
                                                      color: done
                                                          ? CoachDashboardTheme.success
                                                          : CoachDashboardTheme.danger,
                                                      fontWeight: FontWeight.w500,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            );
                                          }),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _DayMealsBucket {
  final Map<String, _MealForm> mealForms = {
    'breakfast': _MealForm(),
    'lunch': _MealForm(),
    'dinner': _MealForm(),
  };
  final List<_MealForm> snackForms = [];

  void clear() {
    for (final form in mealForms.values) {
      form.clearFields();
    }
    for (final form in snackForms) {
      form.dispose();
    }
    snackForms.clear();
  }

  void loadFromMeals(List<DietMeal> meals) {
    clear();
    for (final meal in meals) {
      if (meal.type == 'snacks') {
        snackForms.add(_MealForm()..load(meal));
      } else {
        mealForms[meal.type]?.load(meal);
      }
    }
  }

  List<DietMeal> buildMeals() {
    final meals = mealForms.entries
        .where((e) => e.value.hasContent)
        .map((e) => e.value.toMeal(e.key))
        .toList();
    meals.addAll(snackForms.where((f) => f.hasContent).map((f) => f.toMeal('snacks')));
    return meals;
  }

  bool get isCompleteForWeeklyPlan {
    if (!mealForms['breakfast']!.hasContent) return false;
    if (!mealForms['lunch']!.hasContent) return false;
    if (!mealForms['dinner']!.hasContent) return false;
    if (!snackForms.any((f) => f.hasContent)) return false;
    return true;
  }

  List<String> missingWeeklySections() {
    final missing = <String>[];
    if (!mealForms['breakfast']!.hasContent) missing.add('Breakfast');
    if (!mealForms['lunch']!.hasContent) missing.add('Lunch');
    if (!mealForms['dinner']!.hasContent) missing.add('Dinner');
    if (!snackForms.any((f) => f.hasContent)) missing.add('Snacks');
    return missing;
  }

  List<String> missingMealTimes() {
    // Breakfast / Lunch / Dinner only — snacks never require a reminder time.
    final missing = <String>[];
    for (final entry in mealForms.entries) {
      if (entry.value.hasContent && !entry.value.hasValidMealTime) {
        missing.add(entry.key[0].toUpperCase() + entry.key.substring(1));
      }
    }
    return missing;
  }

  void dispose() {
    for (final form in mealForms.values) {
      form.dispose();
    }
    for (final form in snackForms) {
      form.dispose();
    }
    snackForms.clear();
  }
}

class _MealForm {
  final name = TextEditingController();
  final description = TextEditingController();
  final calories = TextEditingController();
  final protein = TextEditingController();
  final carbs = TextEditingController();
  final fats = TextEditingController();
  final reminder = TextEditingController();
  /// Preserved when editing so existing plans keep prep/notes/portion after UI simplification.
  String _preservedPrep = '';
  String _preservedNotes = '';
  String _preservedPortion = '';

  bool get hasContent =>
      name.text.trim().isNotEmpty ||
      description.text.trim().isNotEmpty ||
      (int.tryParse(calories.text.trim()) ?? 0) > 0 ||
      reminder.text.trim().isNotEmpty;

  bool get hasValidMealTime {
    final raw = reminder.text.trim();
    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(raw);
    if (match == null) return false;
    final h = int.tryParse(match.group(1)!);
    final m = int.tryParse(match.group(2)!);
    return h != null && m != null && h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }

  void clearFields() {
    name.clear();
    description.clear();
    calories.clear();
    protein.clear();
    carbs.clear();
    fats.clear();
    reminder.clear();
    _preservedPrep = '';
    _preservedNotes = '';
    _preservedPortion = '';
  }

  void load(DietMeal meal) {
    name.text = meal.name;
    final desc = meal.description.trim();
    description.text = desc.isNotEmpty ? desc : meal.foodItems.join('\n');
    calories.text = meal.calories > 0 ? '${meal.calories}' : '';
    protein.text = meal.protein > 0 ? '${meal.protein}' : '';
    carbs.text = meal.carbs > 0 ? '${meal.carbs}' : '';
    fats.text = meal.fats > 0 ? '${meal.fats}' : '';
    reminder.text = meal.reminderTime;
    _preservedPrep = meal.prepInstructions;
    _preservedNotes = meal.mealNotes;
    _preservedPortion = meal.portionSize;
  }

  DietMeal toMeal(String type) {
    final desc = description.text.trim();
    final items = desc
        .split(RegExp(r'[\n,;]'))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    // Snacks are diet-plan content only — never attach a reminder time.
    var reminderTime = '';
    if (type != 'snacks') {
      reminderTime = reminder.text.trim();
      final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(reminderTime);
      if (match != null) {
        final h = int.parse(match.group(1)!).clamp(0, 23);
        final m = int.parse(match.group(2)!).clamp(0, 59);
        reminderTime = '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}';
      }
    }
    return DietMeal(
      type: type,
      name: name.text.trim().isEmpty
          ? (type == 'snacks' ? 'Snack' : DietMeal.empty(type).name)
          : name.text.trim(),
      description: desc,
      foodItems: items,
      portionSize: _preservedPortion,
      calories: int.tryParse(calories.text.trim()) ?? 0,
      protein: int.tryParse(protein.text.trim()) ?? 0,
      carbs: int.tryParse(carbs.text.trim()) ?? 0,
      fats: int.tryParse(fats.text.trim()) ?? 0,
      reminderTime: reminderTime,
      prepInstructions: _preservedPrep,
      mealNotes: _preservedNotes,
    );
  }

  void dispose() {
    name.dispose();
    description.dispose();
    calories.dispose();
    protein.dispose();
    carbs.dispose();
    fats.dispose();
    reminder.dispose();
  }
}

/// Shared essential meal fields for create/edit diet meals.
class _MealEssentialFields extends StatelessWidget {
  final _MealForm form;
  final bool isDark;
  final bool readOnly;
  final VoidCallback? onEdited;
  final String nameLabel;
  /// When false (snacks), hide meal-time / reminder picker.
  final bool showReminderTime;

  const _MealEssentialFields({
    required this.form,
    required this.isDark,
    this.readOnly = false,
    this.onEdited,
    this.nameLabel = 'Meal Name',
    this.showReminderTime = true,
  });

  void _edited() => onEdited?.call();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TextField(
          controller: form.name,
          readOnly: readOnly,
          onChanged: readOnly ? null : (_) => _edited(),
          decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: nameLabel),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: form.description,
          readOnly: readOnly,
          maxLines: 3,
          onChanged: readOnly ? null : (_) => _edited(),
          decoration: CoachDashboardTheme.fieldDecoration(
            isDark: isDark,
            label: 'Food Items / Description',
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: form.calories,
                readOnly: readOnly,
                keyboardType: TextInputType.number,
                onChanged: readOnly ? null : (_) => _edited(),
                decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Calories'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: form.protein,
                readOnly: readOnly,
                keyboardType: TextInputType.number,
                onChanged: readOnly ? null : (_) => _edited(),
                decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Protein (g)'),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: form.carbs,
                readOnly: readOnly,
                keyboardType: TextInputType.number,
                onChanged: readOnly ? null : (_) => _edited(),
                decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Carbs (g)'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                controller: form.fats,
                readOnly: readOnly,
                keyboardType: TextInputType.number,
                onChanged: readOnly ? null : (_) => _edited(),
                decoration: CoachDashboardTheme.fieldDecoration(isDark: isDark, label: 'Fat (g)'),
              ),
            ),
          ],
        ),
        if (showReminderTime) ...[
          const SizedBox(height: 8),
          _MealTimeField(
            controller: form.reminder,
            isDark: isDark,
            readOnly: readOnly,
            onChanged: readOnly ? null : _edited,
          ),
        ],
      ],
    );
  }
}

class _MealTimeField extends StatelessWidget {
  final TextEditingController controller;
  final bool isDark;
  final bool readOnly;
  final VoidCallback? onChanged;

  const _MealTimeField({
    required this.controller,
    required this.isDark,
    this.readOnly = false,
    this.onChanged,
  });

  TimeOfDay _parsedTime() {
    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(controller.text.trim());
    if (match != null) {
      final h = int.tryParse(match.group(1)!);
      final m = int.tryParse(match.group(2)!);
      if (h != null && m != null) return TimeOfDay(hour: h.clamp(0, 23), minute: m.clamp(0, 59));
    }
    return const TimeOfDay(hour: 8, minute: 0);
  }

  Future<void> _pick(BuildContext context) async {
    if (readOnly) return;
    final picked = await showTimePicker(
      context: context,
      initialTime: _parsedTime(),
      helpText: 'Meal reminder time',
    );
    if (picked == null) return;
    final hh = picked.hour.toString().padLeft(2, '0');
    final mm = picked.minute.toString().padLeft(2, '0');
    controller.text = '$hh:$mm';
    onChanged?.call();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      readOnly: true,
      onTap: readOnly ? null : () => _pick(context),
      decoration: CoachDashboardTheme.fieldDecoration(
        isDark: isDark,
        label: 'Meal Time (reminder)',
      ).copyWith(
        hintText: 'Tap to set reminder time',
        suffixIcon: IconButton(
          tooltip: 'Pick time',
          onPressed: readOnly ? null : () => _pick(context),
          icon: const Icon(Icons.alarm_rounded),
        ),
      ),
    );
  }
}

class _MealSection extends StatelessWidget {
  final String label;
  final _MealForm form;
  final bool isDark;
  final bool readOnly;
  final VoidCallback? onEdited;

  const _MealSection({
    required this.label,
    required this.form,
    required this.isDark,
    this.readOnly = false,
    this.onEdited,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: ExpansionTile(
        initiallyExpanded: label == 'breakfast',
        title: Text(label[0].toUpperCase() + label.substring(1), style: CoachDashboardTheme.sectionTitle(isDark)),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _MealEssentialFields(
              form: form,
              isDark: isDark,
              readOnly: readOnly,
              onEdited: onEdited,
            ),
          ),
        ],
      ),
    );
  }
}

const List<String> _snackOptions = [
  'Greek yogurt with berries',
  'Apple with peanut butter',
  'Handful of almonds',
  'Mixed nuts',
  'Protein bar',
  'Protein shake',
  'Cottage cheese',
  'Hummus with carrot sticks',
  'Banana',
  'Boiled eggs',
  'Rice cakes',
  'Dark chocolate (1 square)',
  'Trail mix',
  'String cheese',
  'Edamame',
  'Oatmeal',
];

class _SnacksListSection extends StatelessWidget {
  final List<_MealForm> snackForms;
  final List<_MealForm> customSnackForms;
  final bool isDark;
  final bool readOnly;
  final bool Function(String name) isPresetSelected;
  final void Function(String name, bool selected) onTogglePreset;
  final void Function({String? presetName}) onAdd;
  final void Function(_MealForm form) onRemove;

  const _SnacksListSection({
    required this.snackForms,
    required this.customSnackForms,
    required this.isDark,
    required this.readOnly,
    required this.isPresetSelected,
    required this.onTogglePreset,
    required this.onAdd,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final filledCount = snackForms.where((f) => f.hasContent).length;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: ExpansionTile(
        initiallyExpanded: true,
        title: Text('Snacks', style: CoachDashboardTheme.sectionTitle(isDark)),
        subtitle: Text(
          filledCount == 0
              ? 'Select snacks below (no reminder)'
              : '$filledCount snack${filledCount == 1 ? '' : 's'} selected · no reminder',
          style: CoachDashboardTheme.bodyMuted(isDark),
        ),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Select snacks', style: CoachDashboardTheme.bodyMuted(isDark)),
                const SizedBox(height: 8),
                Container(
                  constraints: const BoxConstraints(maxHeight: 240),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                  ),
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _snackOptions.length,
                    separatorBuilder: (_, __) => Divider(
                      height: 1,
                      color: isDark ? Colors.white12 : Colors.black12,
                    ),
                    itemBuilder: (context, i) {
                      final option = _snackOptions[i];
                      final selected = isPresetSelected(option);
                      return CheckboxListTile(
                        value: selected,
                        onChanged: readOnly ? null : (v) => onTogglePreset(option, v ?? false),
                        dense: true,
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                        activeColor: CoachDashboardTheme.primary,
                        title: Text(option, style: const TextStyle(fontSize: 13)),
                      );
                    },
                  ),
                ),
                if (customSnackForms.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text('Custom snacks', style: CoachDashboardTheme.bodyMuted(isDark)),
                  const SizedBox(height: 8),
                ],
                ...customSnackForms.asMap().entries.map((entry) {
                  final form = entry.value;
                  final index = entry.key + 1;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark ? Colors.white.withValues(alpha: 0.04) : Colors.black.withValues(alpha: 0.03),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text('Custom snack $index', style: CoachDashboardTheme.sectionTitle(isDark)),
                            const Spacer(),
                            if (!readOnly)
                              IconButton(
                                tooltip: 'Remove snack',
                                onPressed: () => onRemove(form),
                                icon: Icon(
                                  Icons.delete_outline_rounded,
                                  size: 20,
                                  color: CoachDashboardTheme.danger.withValues(alpha: 0.85),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        _MealEssentialFields(
                          form: form,
                          isDark: isDark,
                          readOnly: readOnly,
                          nameLabel: 'Snack Name',
                          showReminderTime: false,
                        ),
                      ],
                    ),
                  );
                }),
                if (!readOnly) ...[
                  const SizedBox(height: 4),
                  OutlinedButton.icon(
                    onPressed: () => onAdd(),
                    icon: const Icon(Icons.add_rounded),
                    label: const Text('Add Custom Snack'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
