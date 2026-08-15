import 'package:flutter/material.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../utils/async_load.dart';
import '../../../utils/coach_specialization.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/tab_refresh.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../widgets/coach_home/coach_home_sections.dart';
import 'coach_notifications_tab.dart';
import 'coach_assignments_tab.dart';
import 'coach_appointments_tab.dart';

class CoachHomeTab extends StatefulWidget {
  final User coach;
  final Function(int) onNavigate;
  final void Function(Widget screen)? onOpenSection;
  final VoidCallback? onViewClientRequests;

  const CoachHomeTab({
    super.key,
    required this.coach,
    required this.onNavigate,
    this.onOpenSection,
    this.onViewClientRequests,
  });

  @override
  State<CoachHomeTab> createState() => CoachHomeTabState();
}

class CoachHomeTabState extends State<CoachHomeTab> with TabRefreshMixin {
  final ApiService _apiService = ApiService();
  List<dynamic> _clients = [];
  List<dynamic> _sessions = [];
  List<dynamic> _pendingClientRequests = [];

  @override
  void initState() {
    super.initState();
    _fetchDashboardData();
  }

  Future<void> refresh() => _fetchDashboardData(isRefresh: true);

  Future<void> _fetchDashboardData({bool isRefresh = false}) async {
    beginTabLoad(isRefresh: isRefresh);
    try {
      final results = await waitIsolatedTimed<Object?>([
        _apiService.getCoachClients(),
        _apiService.getSessions(),
        _apiService.getCoachRequests(),
      ], fallback: null);

      final clients = results[0] is List ? List<dynamic>.from(results[0] as List) : <dynamic>[];
      final sessions = results[1] is List ? List<dynamic>.from(results[1] as List) : <dynamic>[];
      final requests = results[2] is List ? List<dynamic>.from(results[2] as List) : <dynamic>[];
      if (results.every((r) => r == null)) {
        finishTabError(
          Exception('Unable to load dashboard. Please retry.'),
          isRefresh: isRefresh,
        );
        return;
      }

      if (mounted) {
        finishTabLoad(() {
          _clients = clients;
          _sessions = sessions;
          _pendingClientRequests = requests;
        });
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

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _formattedDate() {
    final now = DateTime.now();
    const months = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return '${days[now.weekday - 1]}, ${months[now.month]} ${now.day}';
  }

  int get _clientsNeedingAction {
    return _clients.where((c) => c['snapshot']?['analysis']?['isActionRequired'] == true).length;
  }

  List<dynamic> get _todaySessions {
    final now = DateTime.now();
    return _sessions.where((s) {
      final d = DateTime.tryParse(s['date'] ?? '');
      return d != null && d.year == now.year && d.month == now.month && d.day == now.day;
    }).toList()
      ..sort((a, b) {
        final da = DateTime.tryParse(a['date'] ?? '') ?? DateTime(2000);
        final db = DateTime.tryParse(b['date'] ?? '') ?? DateTime(2000);
        return da.compareTo(db);
      });
  }

  List<CoachStatCardData> _buildStats() {
    return [
      CoachStatCardData(
        label: 'Total Clients',
        value: '${_clients.length}',
        icon: Icons.people_alt_rounded,
        color: CoachDashboardTheme.primary,
        subtitle: 'Active roster',
      ),
      CoachStatCardData(
        label: 'Sessions Today',
        value: '${_todaySessions.length}',
        icon: Icons.today_rounded,
        color: CoachDashboardTheme.accent,
        subtitle: 'On your schedule',
      ),
      CoachStatCardData(
        label: 'Needs Action',
        value: '$_clientsNeedingAction',
        icon: Icons.warning_amber_rounded,
        color: CoachDashboardTheme.danger,
        subtitle: 'Clients to review',
      ),
      CoachStatCardData(
        label: 'Client Requests',
        value: '${_pendingClientRequests.length}',
        icon: Icons.person_add_alt_1_rounded,
        color: CoachDashboardTheme.warning,
        subtitle: 'Pending approval',
      ),
    ];
  }

  List<CoachQuickActionData> _buildQuickActions() {
    final specs = coachSpecializationsFromUser(widget.coach);
    final actions = <CoachQuickActionData>[
      CoachQuickActionData(
        label: 'Appointments',
        icon: Icons.event_available_rounded,
        color: CoachDashboardTheme.accent,
        onTap: () {
          if (widget.onOpenSection != null) {
            widget.onOpenSection!(const CoachAppointmentsTab());
          }
        },
      ),
      CoachQuickActionData(
        label: 'Review Requests',
        icon: Icons.inbox_rounded,
        color: CoachDashboardTheme.warning,
        onTap: () {
          if (widget.onViewClientRequests != null) {
            widget.onViewClientRequests!();
          } else {
            widget.onNavigate(1);
          }
        },
      ),
      CoachQuickActionData(
        label: 'Add Client',
        icon: Icons.person_add_rounded,
        color: CoachDashboardTheme.primary,
        onTap: () => widget.onNavigate(1),
      ),
    ];
    if (canAccessWorkouts(specs)) {
      actions.add(
        CoachQuickActionData(
          label: 'Create Workout',
          icon: Icons.fitness_center_rounded,
          color: CoachDashboardTheme.danger,
          onTap: () {
            if (widget.onOpenSection != null) {
              widget.onOpenSection!(const CoachAssignmentsTab());
            } else {
              _showAssignWorkoutModal();
            }
          },
        ),
      );
    }
    actions.add(
      CoachQuickActionData(
        label: 'Schedule Session',
        icon: Icons.calendar_month_rounded,
        color: CoachDashboardTheme.success,
        onTap: _showCreateScheduleModal,
      ),
    );
    return actions;
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  void _openDrawer() {
    final scaffold = Scaffold.maybeOf(context);
    if (scaffold?.hasDrawer == true) scaffold!.openDrawer();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (showInitialLoading) {
      return const ScrollableCenter(child: CircularProgressIndicator());
    }

    if (showInitialError) {
      return ScrollableCenter(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            Text('Error: $tabLoadError', textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: () => _fetchDashboardData(), child: const Text('Retry')),
          ],
        ),
      );
    }

    return Container(
      color: CoachDashboardTheme.homeBackground(isDark),
      child: RefreshIndicator(
        onRefresh: () => _fetchDashboardData(isRefresh: true),
        color: CoachDashboardTheme.primary,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            const sectionGap = SizedBox(height: 24);

            return ListView(
              physics: dashboardScrollPhysics,
              padding: EdgeInsets.fromLTRB(width >= 800 ? 20 : 16, 12, width >= 800 ? 20 : 16, 100),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 12),
                  child: Text(
                    'Dashboard',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.8,
                      color: isDark ? Colors.white38 : CoachDashboardTheme.textSecondary,
                    ),
                  ),
                ),
                CoachHomeWelcomeHeader(
                greeting: _greeting(),
                coachName: widget.coach.name,
                dateLabel: _formattedDate(),
                subtitle: '${_clients.length} clients · ${_todaySessions.length} sessions today',
                onMenuTap: _openDrawer,
                onNotificationsTap: () {
                  Navigator.push(context, MaterialPageRoute(builder: (ctx) => const CoachNotificationsTab()));
                },
                isDark: isDark,
              ),
              sectionGap,
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 10),
                child: Text('OVERVIEW', style: CoachDashboardTheme.sectionLabel(isDark)),
              ),
              CoachHomeStatsGrid(stats: _buildStats(), isDark: isDark, maxWidth: width),
              if (_pendingClientRequests.isNotEmpty) ...[
                sectionGap,
                _buildPendingRequestsSection(isDark),
              ],
              sectionGap,
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 10),
                child: Text('QUICK ACTIONS', style: CoachDashboardTheme.sectionLabel(isDark)),
              ),
              CoachHomeQuickActions(
                actions: _buildQuickActions(),
                isDark: isDark,
                maxWidth: width,
              ),
              sectionGap,
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 10),
                child: Text('TODAY', style: CoachDashboardTheme.sectionLabel(isDark)),
              ),
              CoachHomeSessionList(
                title: "Today's Schedule",
                icon: Icons.today_rounded,
                iconColor: CoachDashboardTheme.accent,
                sessions: _todaySessions,
                isDark: isDark,
                emptyMessage: 'No sessions scheduled for today',
              ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildPendingRequestsSection(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 10),
          child: Text('CLIENT REQUESTS', style: CoachDashboardTheme.sectionLabel(isDark)),
        ),
        ..._pendingClientRequests.take(3).map((request) {
          final user = request['user'] as Map<String, dynamic>? ?? {};
          final name = ApiService.displayName(user, fallback: 'Member');
          final message = request['message'] as String? ?? '';
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            decoration: CoachDashboardTheme.cardDecoration(isDark),
            padding: const EdgeInsets.all(14),
            width: double.infinity,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                CoachDashboardTheme.avatarBox(
                  initial: name.isNotEmpty ? name[0].toUpperCase() : 'U',
                  size: 40,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                      const SizedBox(height: 2),
                      Text(
                        'Wants to join your coaching',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: CoachDashboardTheme.warning,
                        ),
                      ),
                      if (message.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          message,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.35,
                            color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: isDark ? Colors.white38 : CoachDashboardTheme.textSecondary,
                ),
              ],
            ),
          );
        }),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () {
              if (widget.onViewClientRequests != null) {
                widget.onViewClientRequests!();
              } else {
                widget.onNavigate(1);
              }
            },
            child: const Text('Review all requests'),
          ),
        ),
      ],
    );
  }

  // ── Modals & actions ─────────────────────────────────────────────────

  Future<Map<String, dynamic>?> _showClientSelector() async {
    if (_clients.isEmpty) {
      _snack('You have no active clients yet.');
      return null;
    }

    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return AlertDialog(
          backgroundColor: isDark ? const Color(0xFF1E1E2E) : Colors.white,
          title: const Text('Select a Client', style: TextStyle(fontWeight: FontWeight.bold)),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: _clients.length,
              itemBuilder: (context, index) {
                final c = _clients[index];
                final userMap = c['user'] is Map ? Map<dynamic, dynamic>.from(c['user'] as Map) : null;
                final name = ApiService.displayName(userMap, fallback: 'Client');
                final email = ApiService.displayIdentity(userMap);
                final id = c['user']?['_id']?.toString() ?? c['_id']?.toString() ?? '';
                final assignmentId = c['_id']?.toString() ?? '';

                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: CoachDashboardTheme.primary.withValues(alpha: 0.15),
                    child: Text(
                      name.isNotEmpty ? name[0].toUpperCase() : 'C',
                      style: const TextStyle(color: CoachDashboardTheme.primary, fontWeight: FontWeight.bold),
                    ),
                  ),
                  title: Text(name, style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text(email, style: const TextStyle(fontSize: 12)),
                  onTap: () => Navigator.pop(context, {
                    'id': id,
                    'assignmentId': assignmentId,
                    'name': name,
                  }),
                );
              },
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ],
        );
      },
    );
  }

  void _showCreateScheduleModal() {
    if (_clients.isEmpty) {
      _snack('Add a client before scheduling.');
      return;
    }

    String? selectedClientId;
    DateTime selectedDate = DateTime.now().add(const Duration(days: 1));
    TimeOfDay selectedTime = const TimeOfDay(hour: 10, minute: 0);
    int duration = 60;
    final notesController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Container(
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF1E1E2E) : Colors.white,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                ),
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Create Schedule', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 20),
                    DropdownButtonFormField<String>(
                      decoration: const InputDecoration(labelText: 'Client', border: OutlineInputBorder()),
                      value: selectedClientId,
                      items: _clients
                          .map((c) => c['user']?['_id']?.toString() ?? c['_id']?.toString())
                          .whereType<String>()
                          .toSet()
                          .map((id) {
                            final clientObj = _clients.firstWhere(
                              (c) => (c['user']?['_id']?.toString() ?? c['_id']?.toString()) == id,
                            );
                            final userMap = clientObj['user'] is Map
                                ? Map<dynamic, dynamic>.from(clientObj['user'] as Map)
                                : null;
                            return DropdownMenuItem(
                              value: id,
                              child: Text(ApiService.displayName(userMap, fallback: 'Client')),
                            );
                          })
                          .toList(),
                      onChanged: (val) => setModalState(() => selectedClientId = val),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.calendar_today),
                            label: Text('${selectedDate.month}/${selectedDate.day}/${selectedDate.year}'),
                            onPressed: () async {
                              final date = await showDatePicker(
                                context: context,
                                initialDate: selectedDate,
                                firstDate: DateTime.now(),
                                lastDate: DateTime.now().add(const Duration(days: 365)),
                              );
                              if (date != null) setModalState(() => selectedDate = date);
                            },
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            icon: const Icon(Icons.access_time),
                            label: Text(selectedTime.format(context)),
                            onPressed: () async {
                              final time = await showTimePicker(context: context, initialTime: selectedTime);
                              if (time != null) setModalState(() => selectedTime = time);
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      decoration: const InputDecoration(labelText: 'Duration (min)', border: OutlineInputBorder()),
                      value: duration,
                      items: const [30, 45, 60, 90, 120]
                          .map((d) => DropdownMenuItem(value: d, child: Text('$d mins')))
                          .toList(),
                      onChanged: (val) => setModalState(() => duration = val ?? 60),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: notesController,
                      decoration: const InputDecoration(labelText: 'Notes', border: OutlineInputBorder()),
                      maxLines: 2,
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: CoachDashboardTheme.primary,
                          foregroundColor: Colors.white,
                        ),
                        onPressed: () async {
                          if (selectedClientId == null) {
                            _snack('Please select a client');
                            return;
                          }
                          final combined = DateTime(
                            selectedDate.year,
                            selectedDate.month,
                            selectedDate.day,
                            selectedTime.hour,
                            selectedTime.minute,
                          );
                          try {
                            await _apiService.createSession({
                              'clientId': selectedClientId,
                              'date': combined.toUtc().toIso8601String(),
                              'durationMinutes': duration,
                              'notes': notesController.text,
                              'sessionMode': 'in_person',
                            });
                            if (context.mounted) Navigator.pop(context);
                            _fetchDashboardData();
                            _snack('Session scheduled successfully');
                          } catch (e) {
                            _snack('Error: $e');
                          }
                        },
                        child: const Text('Save Schedule'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showAssignWorkoutModal() async {
    final client = await _showClientSelector();
    if (client == null) return;

    final clientId = client['id'] as String;
    final clientName = client['name'] as String;
    String level = 'Intermediate';
    final exercisesController = TextEditingController(text: 'Pushups, Squats, Planks');

    if (!mounted) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final isDark = Theme.of(context).brightness == Brightness.dark;
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Container(
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF1E1E2E) : Colors.white,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                ),
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Assign Workout — $clientName', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      decoration: const InputDecoration(labelText: 'Level', border: OutlineInputBorder()),
                      value: level,
                      items: ['Beginner', 'Intermediate', 'Advanced']
                          .map((l) => DropdownMenuItem(value: l, child: Text(l)))
                          .toList(),
                      onChanged: (val) => setModalState(() => level = val ?? 'Intermediate'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: exercisesController,
                      decoration: const InputDecoration(
                        labelText: 'Exercises (comma separated)',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: CoachDashboardTheme.danger,
                          foregroundColor: Colors.white,
                        ),
                        onPressed: () async {
                          final list = exercisesController.text.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
                          if (list.isEmpty) {
                            _snack('Enter at least one exercise');
                            return;
                          }
                          try {
                            await _apiService.createExercisePlan({
                              'clientId': clientId,
                              'level': level,
                              'exercises': list.map((name) => {
                                'name': name,
                                'sets': 3,
                                'reps': 10,
                              }).toList(),
                            });
                            if (context.mounted) Navigator.pop(context);
                            _fetchDashboardData();
                            _snack('Workout assigned');
                          } catch (e) {
                            _snack('Error: $e');
                          }
                        },
                        child: const Text('Assign Workout'),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

}
