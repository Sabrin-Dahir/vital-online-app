import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../utils/async_load.dart';
import '../../../utils/coach_specialization.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/tab_refresh.dart';
import '../../../widgets/profile_avatar.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import 'coach_class_detail_screen.dart';
import 'coach_session_detail_sheet.dart';
import '../../../widgets/silent_refresh.dart';

class CoachClassesTab extends StatefulWidget {
  const CoachClassesTab({super.key});

  @override
  State<CoachClassesTab> createState() => CoachClassesTabState();
}

class CoachClassesTabState extends State<CoachClassesTab> with SingleTickerProviderStateMixin, TabRefreshMixin {
  final ApiService _apiService = ApiService();
  List<dynamic> _classes = [];
  List<dynamic> _sessions = [];
  List<dynamic> _clients = [];
  late TabController _tabCtrl;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    _tabCtrl.addListener(() => setState(() {}));
    _fetchData();
  }

  @override
  void dispose() {
    _tabCtrl.dispose();
    super.dispose();
  }

  Future<void> refresh() => _fetchData(isRefresh: true);

  Future<void> _fetchData({bool isRefresh = false}) async {
    beginTabLoad(isRefresh: isRefresh);
    try {
      final results = await waitIsolatedTimed<Object?>([
        _apiService.getCoachClasses(),
        _apiService.getSessions(),
        _apiService.getCoachClients(light: true),
      ], fallback: null);
      if (results.every((r) => r == null)) {
        finishTabError(
          Exception('Unable to load classes. Please retry.'),
          isRefresh: isRefresh,
        );
        return;
      }
      if (mounted) {
        finishTabLoad(() {
          _classes = results[0] is List ? List<dynamic>.from(results[0] as List) : <dynamic>[];
          _sessions = results[1] is List ? List<dynamic>.from(results[1] as List) : <dynamic>[];
          _clients = results[2] is List ? List<dynamic>.from(results[2] as List) : <dynamic>[];
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

  Future<void> _showCreateClassModal() async {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final capacityCtrl = TextEditingController(text: '20');
    String category = 'General';
    List<String> categories = allowedClassCategories(null);
    DateTime selectedDate = DateTime.now().add(const Duration(days: 1));
    TimeOfDay selectedTime = const TimeOfDay(hour: 9, minute: 0);
    int duration = 60;

    try {
      final me = await _apiService.getMe();
      categories = allowedClassCategories(coachSpecializationsFromUser(me));
      category = categories.isNotEmpty ? categories.first : 'General Fitness';
    } catch (_) {}

    if (!mounted) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? const Color(0xFF1E1E2E)
                      : Colors.white,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                ),
                padding: const EdgeInsets.all(24),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Create Group Class', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),
                      TextField(
                        controller: titleCtrl,
                        decoration: const InputDecoration(labelText: 'Class Title', border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: descCtrl,
                        decoration: const InputDecoration(labelText: 'Description', border: OutlineInputBorder()),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: categories.contains(category) ? category : categories.first,
                        decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()),
                        items: categories
                            .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                            .toList(),
                        onChanged: (v) => setModalState(() => category = v ?? category),
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
                        value: duration,
                        decoration: const InputDecoration(labelText: 'Duration (min)', border: OutlineInputBorder()),
                        items: const [30, 45, 60, 75, 90]
                            .map((d) => DropdownMenuItem(value: d, child: Text('$d mins')))
                            .toList(),
                        onChanged: (v) => setModalState(() => duration = v ?? 60),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: capacityCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Capacity', border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: CoachDashboardTheme.accent,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                          onPressed: () async {
                            if (titleCtrl.text.trim().isEmpty) return;
                            final combined = DateTime(
                              selectedDate.year,
                              selectedDate.month,
                              selectedDate.day,
                              selectedTime.hour,
                              selectedTime.minute,
                            );
                            try {
                              await _apiService.createCoachClass({
                                'title': titleCtrl.text.trim(),
                                'description': descCtrl.text.trim(),
                                'category': category,
                                'date': combined.toIso8601String(),
                                'durationMinutes': duration,
                                'capacity': int.tryParse(capacityCtrl.text) ?? 20,
                              });
                              if (context.mounted) Navigator.pop(context);
                              _fetchData();
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('Class created!'), backgroundColor: Colors.green),
                              );
                            } catch (e) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: Colors.redAccent),
                              );
                            }
                          },
                          child: const Text('Create Class'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showCreateSessionModal() {
    if (_clients.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a client before scheduling.')));
      return;
    }

    String? selectedClientId;
    DateTime selectedDate = DateTime.now().add(const Duration(days: 1));
    TimeOfDay selectedTime = const TimeOfDay(hour: 10, minute: 0);
    int duration = 60;
    String sessionMode = 'in_person';
    final notesController = TextEditingController();
    final linkController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
              child: Container(
                decoration: BoxDecoration(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? const Color(0xFF1E1E2E)
                      : Colors.white,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                ),
                padding: const EdgeInsets.all(24),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Schedule 1-on-1 Session', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        decoration: const InputDecoration(labelText: 'Client', border: OutlineInputBorder()),
                        items: _clients.map((c) {
                          final id = c['user']?['_id']?.toString() ?? '';
                          final userMap = c['user'] is Map ? Map<dynamic, dynamic>.from(c['user'] as Map) : null;
                          final name = ApiService.displayName(userMap, fallback: 'Client');
                          return DropdownMenuItem(value: id, child: Text(name));
                        }).toList(),
                        onChanged: (val) => setModalState(() => selectedClientId = val),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.calendar_today),
                              label: Text('${selectedDate.month}/${selectedDate.day}'),
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
                        value: duration,
                        decoration: const InputDecoration(labelText: 'Duration', border: OutlineInputBorder()),
                        items: const [30, 45, 60, 90]
                            .map((m) => DropdownMenuItem(value: m, child: Text('$m min')))
                            .toList(),
                        onChanged: (v) => setModalState(() => duration = v ?? 60),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        value: sessionMode,
                        decoration: const InputDecoration(labelText: 'Session type', border: OutlineInputBorder()),
                        items: const [
                          DropdownMenuItem(value: 'in_person', child: Text('In Person')),
                          DropdownMenuItem(value: 'online', child: Text('Online')),
                        ],
                        onChanged: (v) => setModalState(() => sessionMode = v ?? 'in_person'),
                      ),
                      if (sessionMode == 'online') ...[
                        const SizedBox(height: 12),
                        TextField(
                          controller: linkController,
                          decoration: const InputDecoration(
                            labelText: 'Meeting link',
                            hintText: 'https://...',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ],
                      const SizedBox(height: 12),
                      TextField(
                        controller: notesController,
                        decoration: const InputDecoration(labelText: 'Session goal / notes', border: OutlineInputBorder()),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: () async {
                            if (selectedClientId == null) return;
                            final combined = DateTime(
                              selectedDate.year, selectedDate.month, selectedDate.day,
                              selectedTime.hour, selectedTime.minute,
                            );
                            try {
                              await _apiService.createSession({
                                'clientId': selectedClientId,
                                'date': combined.toUtc().toIso8601String(),
                                'durationMinutes': duration,
                                'notes': notesController.text.trim(),
                                'sessionMode': sessionMode,
                                if (sessionMode == 'online')
                                  'meetingLink': linkController.text.trim(),
                              });
                              if (context.mounted) Navigator.pop(context);
                              if (mounted) {
                                ScaffoldMessenger.of(this.context).showSnackBar(
                                  const SnackBar(content: Text('1-on-1 session scheduled')),
                                );
                              }
                              _fetchData(isRefresh: true);
                            } catch (e) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(ApiService.friendlyError(e))),
                                );
                              }
                            }
                          },
                          child: const Text('Save Session'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _confirmDeleteClass(String id, String title) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Class'),
        content: Text('Delete "$title"?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirm != true) return;

    try {
      await _apiService.deleteCoachClass(id);
      _fetchData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  String _formatDateTime(String? raw) {
    if (raw == null) return 'N/A';
    final dt = DateTime.tryParse(raw);
    if (dt == null) return raw;
    const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final m = dt.minute.toString().padLeft(2, '0');
    final suffix = dt.hour < 12 ? 'AM' : 'PM';
    return '${months[dt.month]} ${dt.day} · $h:$m $suffix';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final onGroupTab = _tabCtrl.index == 0;

    return CoachPage(
      title: 'Classes',
      actions: [
        IconButton(
          icon: tabRefreshIcon(color: Colors.white),
          onPressed: (showInitialLoading || tabIsRefreshing) ? null : () => _fetchData(isRefresh: true),
        ),
      ],
      bottom: TabBar(
        controller: _tabCtrl,
        indicatorColor: CoachDashboardTheme.primary,
        labelColor: CoachDashboardTheme.primary,
        unselectedLabelColor: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
        labelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
        tabs: const [
          Tab(text: 'Group Classes'),
          Tab(text: '1-on-1 Sessions'),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: onGroupTab ? _showCreateClassModal : _showCreateSessionModal,
        icon: const Icon(Icons.add_rounded),
        label: Text(onGroupTab ? 'New Class' : 'New Session'),
        backgroundColor: CoachDashboardTheme.primary,
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: showInitialError
              ? ScrollableCenter(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(tabLoadError!, textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: () => _fetchData(), child: const Text('Retry')),
                    ],
                  ),
                )
              : TabBarView(
                  controller: _tabCtrl,
                  children: [
                    _buildGroupClassesList(isDark),
                    _buildSessionsList(isDark),
                  ],
                ),
    );
  }

  Widget _buildGroupClassesList(bool isDark) {
    if (_classes.isEmpty) {
      return SilentRefreshIndicator(
        onRefresh: () => _fetchData(isRefresh: true),
        color: CoachDashboardTheme.primary,
        child: refreshableScrollChild(
          context: context,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.class_rounded, size: 64, color: isDark ? Colors.white38 : Colors.grey),
              const SizedBox(height: 16),
              Text(
                'No group classes yet',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 280),
                child: Text(
                  'Create a class, then add approved clients to organize training sessions.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return SilentRefreshIndicator(
      onRefresh: () => _fetchData(isRefresh: true),
      color: CoachDashboardTheme.primary,
      child: ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
      itemCount: _classes.length,
      itemBuilder: (context, index) {
        final cls = _classes[index] as Map<String, dynamic>;
        final title = cls['title']?.toString() ?? 'Class';
        final category = cls['category']?.toString() ?? 'General';
        final enrolled = (cls['enrolledStudents'] as List?)?.length ?? cls['enrolledCount'] ?? 0;
        final capacity = (cls['capacity'] as num?)?.toInt() ?? 20;
        final status = cls['status']?.toString() ?? 'scheduled';
        final id = cls['_id']?.toString() ?? '';

        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: CoachDashboardTheme.cardDecoration(isDark),
          child: ListTile(
            contentPadding: const EdgeInsets.all(16),
            leading: Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: CoachDashboardTheme.accent.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.fitness_center_rounded, color: CoachDashboardTheme.accent),
            ),
            title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 4),
                Text('$category · $enrolled / $capacity enrolled'),
                Text(_formatDateTime(cls['date']?.toString()), style: const TextStyle(fontSize: 12)),
                Text('Status: $status', style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ),
            trailing: PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'delete') _confirmDeleteClass(id, title);
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: Colors.red))),
              ],
            ),
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => CoachClassDetailScreen(
                    classData: cls,
                    clients: _clients,
                    onUpdated: () => _fetchData(isRefresh: true),
                  ),
                ),
              );
            },
          ),
        );
      },
    ),
    );
  }

  Widget _buildSessionsList(bool isDark) {
    if (_sessions.isEmpty) {
      return SilentRefreshIndicator(
        onRefresh: () => _fetchData(isRefresh: true),
        color: CoachDashboardTheme.primary,
        child: refreshableScrollChild(
          context: context,
          child: CoachDashboardTheme.emptyState(
            icon: Icons.event_available_outlined,
            title: 'No 1-on-1 sessions',
            message: 'Schedule a session to meet with an individual client.',
            isDark: isDark,
          ),
        ),
      );
    }

    return SilentRefreshIndicator(
      onRefresh: () => _fetchData(isRefresh: true),
      color: CoachDashboardTheme.primary,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
        itemCount: _sessions.length,
        itemBuilder: (context, index) {
          final session = Map<String, dynamic>.from(_sessions[index] as Map);
          final clientMap = session['client'] is Map
              ? Map<dynamic, dynamic>.from(session['client'] as Map)
              : null;
          final clientName = ApiService.displayName(clientMap, fallback: 'Client');
          final photo = clientMap?['avatar']?.toString() ?? clientMap?['photoUrl']?.toString();
          final duration = session['durationMinutes'] ?? 60;
          final dateStr = (session['date'] ?? '').toString();
          final status = session['status']?.toString() ?? 'pending';
          final mode = session['sessionMode']?.toString() == 'online' ? 'Online' : 'In Person';
          final notes = session['notes']?.toString().trim() ?? '';
          final link = session['meetingLink']?.toString().trim() ?? '';

          return InkWell(
            onTap: () async {
              await showCoachSessionDetailSheet(
                context: context,
                session: session,
                onChanged: () => _fetchData(isRefresh: true),
              );
              if (mounted) await _fetchData(isRefresh: true);
            },
            borderRadius: BorderRadius.circular(16),
            child: Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(16),
              decoration: CoachDashboardTheme.cardDecoration(isDark),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ProfileAvatar(name: clientName, photoUrl: photo, radius: 22),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(clientName, style: const TextStyle(fontWeight: FontWeight.bold)),
                            Text(
                              '${_formatDateTime(dateStr)} · $duration min · $mode',
                              style: TextStyle(
                                fontSize: 12,
                                color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        status.replaceAll('_', ' '),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                  if (notes.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      notes,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary,
                      ),
                    ),
                  ],
                  if (link.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Link: $link',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: CoachDashboardTheme.primary),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () async {
                            await showCoachSessionDetailSheet(
                              context: context,
                              session: session,
                              onChanged: () => _fetchData(isRefresh: true),
                            );
                            if (mounted) await _fetchData(isRefresh: true);
                          },
                          child: const Text('Manage'),
                        ),
                      ),
                      if (['confirmed', 'rescheduled'].contains(status)) ...[
                        const SizedBox(width: 8),
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: () async {
                              try {
                                await _apiService.startSession(
                                  session['_id'].toString(),
                                  meetingLink: link.isEmpty ? null : link,
                                  sessionMode: session['sessionMode']?.toString(),
                                );
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(content: Text('Session in progress')),
                                  );
                                }
                                _fetchData(isRefresh: true);
                              } catch (e) {
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text(ApiService.friendlyError(e))),
                                  );
                                }
                              }
                            },
                            icon: const Icon(Icons.play_circle_fill),
                            label: const Text('Start'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: CoachDashboardTheme.primary,
                              foregroundColor: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
