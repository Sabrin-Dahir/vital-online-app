import 'dart:async';

import 'package:flutter/material.dart';
import '../../../l10n/app_localizations.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/tab_refresh.dart';
import '../chat_screen.dart';
import '../../../utils/async_load.dart';
import '../../../utils/coach_thread_utils.dart';
import '../../../utils/coach_specialization.dart';
import '../coach_public_profile_screen.dart';
import '../user_class_detail_screen.dart';
import '../../../widgets/coach_working_days_display.dart';
import '../../../widgets/silent_refresh.dart';

class UserCoachesTab extends StatefulWidget {
  final User user;
  final VoidCallback? onUnreadChanged;

  const UserCoachesTab({super.key, required this.user, this.onUnreadChanged});

  @override
  State<UserCoachesTab> createState() => _UserCoachesTabState();
}

class _UserCoachesTabState extends State<UserCoachesTab> with TabRefreshMixin {
  final ApiService _apiService = ApiService();
  Map<String, dynamic>? _coachingData;
  Map<String, dynamic>? _coachRequest;
  List<dynamic> _allCoaches = [];
  List<dynamic> _myClasses = [];
  String? _lastCoachMessage;
  int _unreadMessageCount = 0;
  Timer? _statusPoll;
  bool _mutatingRequest = false;
  String? _mutatingCoachId;

  bool get _hasActiveCoach => _coachingData != null;
  bool get _hasPendingRequest => _coachRequest?['status'] == 'pending';
  bool get _hasRejectedRequest => _coachRequest?['status'] == 'rejected';
  bool get _hasSelectedCoach => _hasActiveCoach || _hasPendingRequest;
  bool get _canRequestCoach => !_hasSelectedCoach && !_mutatingRequest;

  bool _isApprovedCoach(dynamic coach) {
    if (coach is! Map) return false;
    final status = coach['status']?.toString() ?? 'active';
    if (status == 'suspended' || status == 'pending' || status == 'deleted') {
      return false;
    }
    final approval = coach['approval_status']?.toString()
        ?? (coach['coachData'] is Map ? coach['coachData']['approval_status']?.toString() : null);
    // Missing approval is allowed for legacy coaches already filtered by the API.
    if (approval == 'pending' || approval == 'rejected') {
      return false;
    }
    final role = coach['role']?.toString();
    return role == null || role == 'coach';
  }

  List<String> _coachSpecializations(dynamic coach) {
    if (coach is! Map) return [];
    final profile = coach['profile'];
    if (profile is! Map) return [];
    final specs = profile['specialization'];
    if (specs is List) {
      return specs.map((item) => item.toString()).where((item) => item.isNotEmpty).toList();
    }
    if (specs is String && specs.trim().isNotEmpty) {
      return specs.split(',').map((item) => item.trim()).where((item) => item.isNotEmpty).toList();
    }
    return [];
  }

  Map<String, dynamic>? get _selectedCoach {
    if (_hasActiveCoach) {
      return _coachingData!['coach'] as Map<String, dynamic>?;
    }
    if (_hasPendingRequest) {
      return _coachRequest?['coach'] as Map<String, dynamic>?;
    }
    return null;
  }

  final List<String> _motivationalQuotes = [
    "The only bad workout is the one that didn't happen.",
    "Don't stop when you're tired. Stop when you're done.",
    "Your body can stand almost anything. It's your mind that you have to convince.",
    "Sore today, strong tomorrow.",
    "Push yourself, because no one else is going to do it for you."
  ];

  @override
  void initState() {
    super.initState();
    _fetchData();
    _statusPoll = Timer.periodic(const Duration(seconds: 12), (_) {
      if (!mounted || !_hasPendingRequest || _mutatingRequest) return;
      _pollRequestStatus();
    });
  }

  @override
  void dispose() {
    _statusPoll?.cancel();
    super.dispose();
  }

  /// Lightweight poll while a request is pending — avoids reloading coaches/classes/chat.
  Future<void> _pollRequestStatus() async {
    try {
      final results = await Future.wait([
        _apiService.getUserCoaching(),
        _apiService.getMyCoachRequest(),
      ]);
      if (!mounted || _mutatingRequest) return;
      final coaching = results[0] as Map<String, dynamic>?;
      final request = results[1] as Map<String, dynamic>?;
      final changed = coaching != null
          || request?['status'] != _coachRequest?['status']
          || request?['_id']?.toString() != _coachRequest?['_id']?.toString();
      if (!changed && coaching == null && _coachingData == null) return;

      setState(() {
        _coachingData = coaching;
        _coachRequest = request;
      });
      if (coaching != null) {
        widget.onUnreadChanged?.call();
      }
    } catch (_) {
      // Keep showing current pending UI on transient poll failures.
    }
  }

  String? get _memberFitnessGoal =>
      normalizeFitnessGoal(widget.user.profile?.fitnessGoal);

  List<dynamic> _filterMatchingCoaches(Iterable<dynamic> coaches) {
    final goal = _memberFitnessGoal;
    final approved = coaches.where(_isApprovedCoach);
    if (goal == null) return approved.toList();
    return approved.where((c) => coachMatchesFitnessGoal(c, goal)).toList();
  }

  Future<void> _loadDiscoverCoaches() async {
    try {
      final coaches = _filterMatchingCoaches(await _apiService.getCoaches());
      if (mounted && _canRequestCoach) {
        setState(() => _allCoaches = coaches);
      }
    } catch (_) {}
  }

  void _applySubmittedRequest(Map<String, dynamic> request) {
    if (!mounted) return;
    setState(() {
      _coachRequest = request;
      _allCoaches = [];
      _mutatingRequest = false;
      _mutatingCoachId = null;
    });
  }

  Future<void> _fetchData({bool isRefresh = false}) async {
    beginTabLoad(isRefresh: isRefresh);
    try {
      // Parallel + isolated so one slow endpoint cannot freeze Coaches forever.
      final primary = await waitIsolatedTimed<Object?>([
        _apiService.getUserCoaching(),
        _apiService.getMyCoachRequest(),
        _apiService.getUserClasses(),
      ], fallback: null, timeout: const Duration(seconds: 20));

      final coaching = primary[0] is Map
          ? Map<String, dynamic>.from(primary[0] as Map)
          : null;
      final coachRequest = primary[1] is Map
          ? Map<String, dynamic>.from(primary[1] as Map)
          : null;
      final classes = primary[2] is List
          ? List<dynamic>.from(primary[2] as List)
          : <dynamic>[];
      final hasSelectedCoach =
          coaching != null || coachRequest?['status'] == 'pending';

      var coaches = <dynamic>[];
      if (!hasSelectedCoach) {
        try {
          coaches = _filterMatchingCoaches(
            await _apiService.getCoaches().timeout(const Duration(seconds: 15)),
          );
        } catch (_) {
          coaches = <dynamic>[];
        }
      }

      String? lastMessage;
      var unreadCount = 0;
      if (coaching != null) {
        final assignmentId = coaching['_id']?.toString() ?? '';
        if (assignmentId.isNotEmpty) {
          try {
            final threads = await _apiService
                .getChatThreads()
                .timeout(const Duration(seconds: 10));
            for (final t in threads) {
              final thread = Map<String, dynamic>.from(t as Map);
              if (CoachThreadUtils.threadId(thread) == assignmentId) {
                lastMessage = CoachThreadUtils.lastMessagePreview(thread);
                unreadCount = CoachThreadUtils.unreadCount(thread);
                break;
              }
            }
          } catch (_) {}
        }
      }

      if (primary.every((r) => r == null) && !hasSelectedCoach && coaches.isEmpty) {
        finishTabError(
          Exception('Unable to load data. Please retry.'),
          isRefresh: isRefresh,
        );
        return;
      }

      if (mounted) {
        finishTabLoad(() {
          _coachingData = coaching;
          _coachRequest = coachRequest;
          _allCoaches = coaches;
          _myClasses = classes;
          _lastCoachMessage = lastMessage;
          _unreadMessageCount = unreadCount;
        });
        widget.onUnreadChanged?.call();
      }
    } catch (e) {
      // Keep previous coach/request state on refresh failures so a network
      // blip does not wipe an assigned coach or pending request.
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

  void _navigateToChat() {
    if (_coachingData == null) return;
    final assignmentId = _coachingData!['_id']?.toString() ?? '';
    if (assignmentId.isEmpty) return;
    final coach = _coachingData!['coach'];
    final coachName = coach is Map ? (coach['name'] as String? ?? 'Coach') : 'Coach';

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (ctx) => ChatScreen(
          assignmentId: assignmentId,
          coachName: coachName,
          currentUser: widget.user,
        ),
      ),
    ).then((_) => _fetchData(isRefresh: true));
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final quote = _motivationalQuotes[DateTime.now().minute % _motivationalQuotes.length];

    final l10n = AppLocalizations.of(context);

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: CoachDashboardTheme.coachAppBar(
        context: context,
        title: _hasSelectedCoach ? l10n.myCoach : l10n.coaches,
        actions: [
          IconButton(
            icon: tabRefreshIcon(color: Colors.white),
            onPressed: (showInitialLoading || tabIsRefreshing) ? null : () => _fetchData(isRefresh: true),
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
                    ElevatedButton(onPressed: () => _fetchData(), child: const Text('Retry')),
                  ]),
                )
              : SilentRefreshIndicator(
                  onRefresh: () => _fetchData(isRefresh: true),
                  color: CoachDashboardTheme.primary,
                  child: refreshableScrollChild(
                    context: context,
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 100),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      // Motivational Banner
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(colors: [Color(0xFFFFB74D), Color(0xFFF57C00)]),
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [BoxShadow(color: const Color(0xFFFFB74D).withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 4))],
                        ),
                        child: Row(children: [
                          const Icon(Icons.format_quote_rounded, color: Colors.white, size: 32),
                          const SizedBox(width: 12),
                          Expanded(child: Text(quote, style: const TextStyle(color: Colors.white, fontSize: 14, fontStyle: FontStyle.italic, fontWeight: FontWeight.w500))),
                        ]),
                      ),
                      const SizedBox(height: 24),

                      // Assigned / Pending Coach
                      const Text('Your Coach', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 12),
                      if (_hasRejectedRequest && _canRequestCoach) ...[
                        _buildRejectedRequestBanner(isDark),
                        const SizedBox(height: 12),
                      ],
                      if (_hasActiveCoach) ...[
                        _buildAssignedCoachCard(isDark),
                        if (_myClasses.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          _buildMyGroupCard(isDark),
                        ],
                      ] else if (_hasPendingRequest && _selectedCoach != null)
                        _buildSelectedCoachCard(isDark, isPending: true)
                      else if (_hasPendingRequest)
                        _buildPendingRequestCard(isDark)
                      else
                        _buildNoCoachCard(isDark),
                      const SizedBox(height: 24),

                      if (_canRequestCoach) ...[
                        const Text('Discover Coaches', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 12),
                        if (_allCoaches.isEmpty)
                          const Center(child: Padding(
                            padding: EdgeInsets.all(20.0),
                            child: Text('No coaches available currently.', style: TextStyle(color: Colors.grey)),
                          ))
                        else
                          ..._allCoaches.map((c) => _buildCoachListTile(c, isDark)),
                      ],
                    ]),
                  ),
                ),
    );
  }

  Widget _buildAssignedCoachCard(bool isDark) {
    final coach = _coachingData!['coach'] ?? {};
    final name = coach['name'] as String? ?? 'Coach';
    final email = coach['email'] as String? ?? '';
    final specs = _coachSpecializations(coach);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CoachDashboardTheme.primary.withOpacity(0.3), width: 1.5),
        boxShadow: [BoxShadow(color: CoachDashboardTheme.primary.withOpacity(isDark ? 0.2 : 0.1), blurRadius: 15, offset: const Offset(0, 5))],
      ),
      child: Column(children: [
        Row(children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: CoachDashboardTheme.primary.withOpacity(0.15),
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : 'C',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: CoachDashboardTheme.primary),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(width: 6),
              const Icon(Icons.verified_rounded, color: Color(0xFF00D4AA), size: 16),
            ]),
            const SizedBox(height: 4),
            Text(email, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          ])),
        ]),
        const SizedBox(height: 16),
        if (CoachWorkingDaysDisplay.daysFromCoach(coach).isNotEmpty) ...[
          CoachWorkingDaysDisplay(
            workingDays: CoachWorkingDaysDisplay.daysFromCoach(coach),
            isDark: isDark,
          ),
          const SizedBox(height: 16),
        ],
        if (specs.isNotEmpty) ...[
          SizedBox(
            height: 28,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: specs.length,
              itemBuilder: (ctx, i) => Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: CoachDashboardTheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(specs[i].toString(), style: const TextStyle(color: CoachDashboardTheme.primary, fontSize: 11, fontWeight: FontWeight.w600)),
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (_lastCoachMessage != null && _lastCoachMessage!.isNotEmpty) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _unreadMessageCount > 0
                  ? CoachDashboardTheme.warning.withValues(alpha: isDark ? 0.15 : 0.1)
                  : CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.12 : 0.08),
              borderRadius: BorderRadius.circular(12),
              border: _unreadMessageCount > 0
                  ? Border.all(color: CoachDashboardTheme.warning.withValues(alpha: 0.35))
                  : null,
            ),
            child: Row(
              children: [
                Icon(
                  _unreadMessageCount > 0 ? Icons.mark_chat_unread_rounded : Icons.chat_bubble_outline_rounded,
                  size: 16,
                  color: _unreadMessageCount > 0 ? CoachDashboardTheme.warning : CoachDashboardTheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_unreadMessageCount > 0)
                        Text(
                          '$_unreadMessageCount unread message${_unreadMessageCount == 1 ? '' : 's'}',
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: CoachDashboardTheme.warning,
                          ),
                        ),
                      Text(
                        _lastCoachMessage!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: _unreadMessageCount > 0 ? FontWeight.w600 : FontWeight.normal,
                          color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],
        Row(children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: () => _openCoachProfile(
                coach['_id']?.toString() ?? '',
                name,
                canRequest: false,
              ),
              icon: const Icon(Icons.person_rounded, size: 18),
              label: const Text('Profile'),
              style: OutlinedButton.styleFrom(
                foregroundColor: CoachDashboardTheme.primary,
                side: const BorderSide(color: CoachDashboardTheme.primary),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _navigateToChat,
              icon: Icon(
                _unreadMessageCount > 0 ? Icons.mark_chat_unread_rounded : Icons.chat_bubble_rounded,
                size: 18,
              ),
              label: Text(_unreadMessageCount > 0 ? 'Message ($_unreadMessageCount)' : 'Message'),
              style: ElevatedButton.styleFrom(
                backgroundColor: CoachDashboardTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ]),
      ]),
    );
  }

  Widget _buildNoCoachCard(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.withOpacity(0.2)),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.3 : 0.05), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: Column(children: [
        const Icon(Icons.person_search_rounded, size: 48, color: Colors.grey),
        const SizedBox(height: 12),
        const Text('Choose a coach', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        const Text('Browse active coaches below and send a request to the coach you want.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey, fontSize: 13)),
      ]),
    );
  }

  Widget _buildRejectedRequestBanner(bool isDark) {
    final coach = _coachRequest?['coach'] as Map<String, dynamic>? ?? {};
    final name = coach['name'] as String? ?? 'that coach';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF2A1A1A) : const Color(0xFFFFF1F0),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CoachDashboardTheme.danger.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded, color: CoachDashboardTheme.danger),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Your request to $name was not accepted. Choose a different active coach below.',
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                color: isDark ? Colors.white70 : const Color(0xFF7F1D1D),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMyGroupCard(bool isDark) {
    final cls = _myClasses.first as Map<String, dynamic>;
    final title = cls['title'] as String? ?? 'Group Class';
    final category = cls['category'] as String? ?? 'General';
    final dateStr = cls['date'] as String? ?? '';
    final date = DateTime.tryParse(dateStr);
    final dateLabel = date != null
        ? '${date.day}/${date.month}/${date.year} · ${date.hour}:${date.minute.toString().padLeft(2, '0')}'
        : 'Scheduled';

    final classId = cls['_id']?.toString() ?? '';

    return GestureDetector(
      onTap: classId.isEmpty
          ? null
          : () => Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => UserClassDetailScreen(
                    classId: classId,
                    initialData: cls,
                  ),
                ),
              ),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF181B24) : Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFF00D4AA).withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.groups_rounded, color: Color(0xFF00D4AA), size: 20),
                SizedBox(width: 8),
                Expanded(
                  child: Text('Your Group Class', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
                Icon(Icons.chevron_right_rounded, color: Colors.grey),
              ],
            ),
            const SizedBox(height: 8),
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text('$category · $dateLabel', style: const TextStyle(fontSize: 13, color: Colors.grey)),
            const SizedBox(height: 6),
            const Text('Tap to see what\'s inside', style: TextStyle(fontSize: 12, color: Color(0xFF00D4AA))),
          ],
        ),
      ),
    );
  }

  void _openCoachProfile(String coachId, String coachName, {required bool canRequest}) {
    if (coachId.isEmpty || _mutatingRequest) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CoachPublicProfileScreen(
          coachId: coachId,
          coachName: coachName,
          canRequest: canRequest,
          onRequestSubmitted: (request) => _applySubmittedRequest(request),
        ),
      ),
    ).then((submitted) {
      if (submitted is Map) {
        _applySubmittedRequest(Map<String, dynamic>.from(submitted));
      }
    });
  }

  Widget _buildSelectedCoachCard(bool isDark, {bool isPending = false}) {
    final coach = _selectedCoach ?? {};
    final name = coach['name'] as String? ?? 'Coach';
    final coachId = coach['_id']?.toString() ?? '';
    final email = coach['email'] as String? ?? '';
    final specs = _coachSpecializations(coach);
    final message = _coachRequest?['message'] as String? ?? '';

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isPending
              ? CoachDashboardTheme.warning.withValues(alpha: 0.4)
              : CoachDashboardTheme.primary.withOpacity(0.3),
          width: 1.5,
        ),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.2 : 0.05), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (isPending) ...[
            Row(
              children: const [
                Icon(Icons.hourglass_top_rounded, color: CoachDashboardTheme.warning, size: 18),
                SizedBox(width: 8),
                Text('Pending Coach Approval', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
              ],
            ),
            const SizedBox(height: 12),
          ],
          Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: (isPending ? CoachDashboardTheme.warning : CoachDashboardTheme.primary)
                    .withValues(alpha: 0.15),
                child: Text(
                  name.isNotEmpty ? name[0].toUpperCase() : 'C',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: isPending ? CoachDashboardTheme.warning : CoachDashboardTheme.primary,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(child: Text(name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold))),
                        if (!isPending) ...[
                          const SizedBox(width: 6),
                          const Icon(Icons.verified_rounded, color: Color(0xFF00D4AA), size: 16),
                        ],
                      ],
                    ),
                    if (email.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(email, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                    ],
                    if (specs.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(specs.join(', '), style: const TextStyle(fontSize: 12, color: Colors.grey)),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (isPending) ...[
            const SizedBox(height: 12),
            Text(
              'Your request to $name is pending. You may withdraw it if you would like to select another coach.',
              style: const TextStyle(fontSize: 13, color: Colors.grey, height: 1.4),
            ),
            if (message.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Your message: “$message”', style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic)),
            ],
          ],
          const SizedBox(height: 14),
          if (isPending) ...[
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _mutatingRequest ? null : _cancelPendingRequest,
                icon: _mutatingRequest
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: const SizedBox.shrink(),
                      )
                    : const Icon(Icons.swap_horiz_rounded, size: 18),
                label: Text(_mutatingRequest ? 'Withdrawing…' : 'Choose a Different Coach'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: CoachDashboardTheme.warning,
                  side: const BorderSide(color: CoachDashboardTheme.warning),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _openCoachProfile(coachId, name, canRequest: false),
              icon: const Icon(Icons.person_rounded, size: 18),
              label: const Text('View Profile'),
              style: OutlinedButton.styleFrom(
                foregroundColor: CoachDashboardTheme.primary,
                side: const BorderSide(color: CoachDashboardTheme.primary),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPendingRequestCard(bool isDark) {
    final coach = _coachRequest?['coach'] as Map<String, dynamic>? ?? {};
    final name = coach['name'] as String? ?? 'Coach';
    final message = _coachRequest?['message'] as String? ?? '';

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CoachDashboardTheme.warning.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.hourglass_top_rounded, color: CoachDashboardTheme.warning),
              const SizedBox(width: 8),
              const Text('Pending Coach Approval', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Your request to $name is pending. You may withdraw it if you would like to select another coach.',
            style: const TextStyle(fontSize: 14, color: Colors.grey, height: 1.4),
          ),
          if (message.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('Your message: “$message”', style: const TextStyle(fontSize: 13, fontStyle: FontStyle.italic)),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _mutatingRequest ? null : _cancelPendingRequest,
              icon: _mutatingRequest
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: const SizedBox.shrink(),
                    )
                  : const Icon(Icons.swap_horiz_rounded, size: 18),
              label: Text(_mutatingRequest ? 'Withdrawing…' : 'Choose a Different Coach'),
              style: OutlinedButton.styleFrom(
                foregroundColor: CoachDashboardTheme.warning,
                side: const BorderSide(color: CoachDashboardTheme.warning),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _cancelPendingRequest() async {
    if (_mutatingRequest || !_hasPendingRequest) return;
    final coach = _selectedCoach ?? (_coachRequest?['coach'] as Map<String, dynamic>? ?? {});
    final coachName = coach['name'] as String? ?? 'this coach';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => _WithdrawCoachRequestDialog(coachName: coachName),
    );
    if (confirmed != true || !mounted) return;

    final previousRequest = _coachRequest;
    setState(() {
      _mutatingRequest = true;
      _coachRequest = null;
    });

    try {
      await _apiService.cancelCoachRequest();
      if (!mounted) return;
      // Restore discover list without blocking the withdraw success feedback.
      unawaited(_loadDiscoverCoaches());
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Your coaching request has been withdrawn.'),
          backgroundColor: CoachDashboardTheme.success,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _coachRequest = previousRequest;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiService.friendlyError(e))),
      );
    } finally {
      if (mounted) {
        setState(() {
          _mutatingRequest = false;
          _mutatingCoachId = null;
        });
      }
    }
  }

  Future<void> _requestCoach(String coachId, String coachName) async {
    if (_mutatingRequest || !_canRequestCoach || coachId.isEmpty) return;
    final goal = _memberFitnessGoal;
    if (goal == null) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Set your fitness goal before requesting a coach.')),
      );
      return;
    }
    Map<String, dynamic>? coachPayload;
    for (final raw in _allCoaches) {
      if (raw is Map && raw['_id']?.toString() == coachId) {
        coachPayload = Map<String, dynamic>.from(raw);
        break;
      }
    }
    if (coachPayload != null && !coachMatchesFitnessGoal(coachPayload, goal)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Request rejected: Coach specialization does not match the client's fitness goal.",
          ),
        ),
      );
      return;
    }
    final message = await showDialog<String>(
      context: context,
      builder: (ctx) => _CoachRequestDialog(coachName: coachName),
    );
    if (message == null || !mounted) return;
    if (_mutatingRequest || _hasPendingRequest || _hasActiveCoach) return;

    coachPayload ??= {'_id': coachId, 'name': coachName};

    final previousRequest = _coachRequest;
    final previousCoaches = List<dynamic>.from(_allCoaches);
    setState(() {
      _mutatingRequest = true;
      _mutatingCoachId = coachId;
      _coachRequest = {
        '_id': 'pending-local',
        'status': 'pending',
        'message': message,
        'coach': coachPayload,
      };
      _allCoaches = [];
    });

    try {
      final created = await _apiService.submitCoachRequest(
        coachId: coachId,
        message: message,
      );
      if (!mounted) return;
      _applySubmittedRequest(created);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Coach request sent!'), backgroundColor: CoachDashboardTheme.success),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _coachRequest = previousRequest;
        _allCoaches = previousCoaches;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ApiService.friendlyError(e))),
      );
    } finally {
      if (mounted) {
        setState(() {
          _mutatingRequest = false;
          _mutatingCoachId = null;
        });
      }
    }
  }

  Widget _buildCoachListTile(Map<dynamic, dynamic> coach, bool isDark) {
    final name = coach['name'] as String? ?? 'Coach';
    final coachId = coach['_id']?.toString() ?? '';
    final specs = _coachSpecializations(coach);
    final pendingCoachId = _coachRequest?['coach']?['_id']?.toString() ?? _coachRequest?['coach']?.toString();
    final isRequestedCoach = _hasPendingRequest && pendingCoachId == coachId;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(isDark ? 0.2 : 0.05), blurRadius: 8, offset: const Offset(0, 3))],
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: const Color(0xFF00D4AA).withOpacity(0.15),
          child: Text(
            name.isNotEmpty ? name[0].toUpperCase() : 'C',
            style: const TextStyle(color: Color(0xFF00D4AA), fontWeight: FontWeight.bold),
          ),
        ),
        title: Text(name, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(specs.isNotEmpty ? specs.join(', ') : 'General Fitness', style: const TextStyle(fontSize: 12)),
            if (CoachWorkingDaysDisplay.daysFromCoach(coach).isNotEmpty) ...[
              const SizedBox(height: 4),
              CoachWorkingDaysDisplay(
                workingDays: CoachWorkingDaysDisplay.daysFromCoach(coach),
                compact: true,
                isDark: isDark,
              ),
            ],
          ],
        ),
        trailing: isRequestedCoach
            ? const Chip(
                label: Text('Pending Coach Approval', style: TextStyle(fontSize: 11)),
                backgroundColor: Color(0xFFFFF3E0),
              )
            : _canRequestCoach
                ? FilledButton(
                    onPressed: (coachId.isEmpty || _mutatingRequest)
                        ? null
                        : () => _requestCoach(coachId, name),
                    style: FilledButton.styleFrom(
                      backgroundColor: CoachDashboardTheme.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: _mutatingCoachId == coachId
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: const SizedBox.shrink(),
                          )
                        : const Text('Request', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                  )
                : const Icon(Icons.chevron_right_rounded, color: Colors.grey),
        onTap: () => _openCoachProfile(coachId, name, canRequest: _canRequestCoach),
      ),
    );
  }
}

class _CoachRequestDialog extends StatefulWidget {
  final String coachName;

  const _CoachRequestDialog({required this.coachName});

  @override
  State<_CoachRequestDialog> createState() => _CoachRequestDialogState();
}

class _CoachRequestDialogState extends State<_CoachRequestDialog> {
  final _messageController = TextEditingController();
  final _focusNode = FocusNode();

  @override
  void dispose() {
    _messageController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF181B24) : Colors.white;
    final muted = isDark ? Colors.white60 : CoachDashboardTheme.textSecondary;
    final border = isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB);
    final initials = widget.coachName.trim().isNotEmpty
        ? widget.coachName.trim()[0].toUpperCase()
        : 'C';

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 420),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 24,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(20, 20, 12, 18),
              decoration: const BoxDecoration(
                gradient: CoachDashboardTheme.headerGradient,
                borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      initials,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 20,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Coaching Request',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.4,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          widget.coachName,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded, color: Colors.white70),
                    tooltip: 'Close',
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Introduce yourself and share your fitness goals. Your coach will review this before accepting.',
                    style: TextStyle(fontSize: 13.5, height: 1.45, color: muted),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'Personal message',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _messageController,
                    focusNode: _focusNode,
                    maxLines: 4,
                    maxLength: 400,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      hintText: 'Example: I want to lose weight and build consistency 3 days a week…',
                      hintStyle: TextStyle(color: muted.withValues(alpha: 0.8), fontSize: 13),
                      filled: true,
                      fillColor: isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB),
                      counterStyle: TextStyle(fontSize: 11, color: muted),
                      contentPadding: const EdgeInsets.all(14),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: border),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: CoachDashboardTheme.primary, width: 1.5),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                        side: BorderSide(color: border),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('Cancel', style: TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton.icon(
                      onPressed: () => Navigator.pop(context, _messageController.text.trim()),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: CoachDashboardTheme.primary,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: const Icon(Icons.send_rounded, size: 18),
                      label: const Text('Send Request', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WithdrawCoachRequestDialog extends StatelessWidget {
  final String coachName;

  const _WithdrawCoachRequestDialog({required this.coachName});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final surface = isDark ? const Color(0xFF181B24) : Colors.white;
    final muted = isDark ? Colors.white60 : CoachDashboardTheme.textSecondary;
    final border = isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB);

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 420),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(20),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 24,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.fromLTRB(20, 20, 12, 18),
              decoration: BoxDecoration(
                color: CoachDashboardTheme.warning.withValues(alpha: isDark ? 0.22 : 0.12),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: CoachDashboardTheme.warning.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.swap_horiz_rounded, color: CoachDashboardTheme.warning, size: 26),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Change coach',
                          style: TextStyle(
                            color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.4,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Withdraw current request?',
                          style: TextStyle(
                            color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context, false),
                    icon: Icon(Icons.close_rounded, color: isDark ? Colors.white70 : Colors.black54),
                    tooltip: 'Close',
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
              child: Text(
                'Your pending request for $coachName will be cancelled. You can then browse coaches and send a new coaching request.',
                style: TextStyle(fontSize: 14, height: 1.5, color: muted),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context, false),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                        side: BorderSide(color: border),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('Keep Request', style: TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    flex: 2,
                    child: ElevatedButton(
                      onPressed: () => Navigator.pop(context, true),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: CoachDashboardTheme.warning,
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('Withdraw Request', style: TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
