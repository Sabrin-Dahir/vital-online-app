import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../utils/async_load.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/admin_management_widgets.dart';
import '../screens/admin_member_detail_screen.dart';
import '../../../screens/auth/coach_register_screen.dart';

class AdminCoachesTab extends StatefulWidget {
  final User adminUser;

  const AdminCoachesTab({super.key, required this.adminUser});

  @override
  AdminCoachesTabState createState() => AdminCoachesTabState();
}

class AdminCoachesTabState extends State<AdminCoachesTab> {
  final ApiService _apiService = ApiService();
  int _selectedSubTab = 0;
  int _coachStatusFilter = 0;

  List<dynamic> _applications = [];
  List<dynamic> _coaches = [];
  List<dynamic> _filteredCoaches = [];
  bool _isLoading = true;
  String? _errorMessage;
  String _coachSearchQuery = '';

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    final showFullLoader = _coaches.isEmpty && _applications.isEmpty;
    setState(() {
      if (showFullLoader) _isLoading = true;
      _errorMessage = null;
    });
    try {
      final results = await waitIsolatedTimed<Object?>([
        _apiService.getCoachApplications(),
        _apiService.getAdminTrainers(),
      ], fallback: null, timeout: const Duration(seconds: 25));
      if (mounted) {
        final apps = results[0] is List ? List<dynamic>.from(results[0] as List) : <dynamic>[];
        final trainers = results[1] is List ? List<dynamic>.from(results[1] as List) : <dynamic>[];
        setState(() {
          _applications = apps;
          _coaches = trainers
              .where((coach) => (coach['role'] as String? ?? '') == 'coach')
              .toList();
          _applyCoachFilters();
          if (results.every((r) => r == null)) {
            _errorMessage = 'Unable to load data';
          } else {
            _errorMessage = null;
          }
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = ApiService.friendlyError(e);
        });
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _applyCoachFilters() {
    Iterable<dynamic> list = _coaches;
    if (_coachStatusFilter == 1) {
      list = list.where((coach) => (coach['status'] as String? ?? 'active') == 'active');
    } else if (_coachStatusFilter == 2) {
      list = list.where((coach) => coach['status'] == 'suspended');
    }
    if (_coachSearchQuery.isNotEmpty) {
      final q = _coachSearchQuery.toLowerCase();
      list = list.where((coach) {
        final map = coach is Map ? Map<dynamic, dynamic>.from(coach) : null;
        final name = ApiService.displayName(map).toLowerCase();
        final identity = ApiService.displayIdentity(map).toLowerCase();
        return name.contains(q) || identity.contains(q);
      });
    }
    _filteredCoaches = list.toList();
  }

  List<dynamic> get _pendingApplications =>
      _applications.where((app) => (app['status'] as String? ?? '') == 'pending').toList();
  int get _activeCoachCount => _coaches.where((c) => (c['status'] as String? ?? 'active') == 'active').length;
  int get _suspendedCoachCount => _coaches.where((c) => c['status'] == 'suspended').length;

  Future<void> _approve(String id) async {
    if (id.isEmpty) return;
    try {
      await _apiService.approveCoachApplication(id);
      if (mounted) {
        setState(() {
          _applications = _applications.map((app) {
            if (app is! Map || app['_id']?.toString() != id) return app;
            return {...Map<String, dynamic>.from(app), 'status': 'approved'};
          }).toList();
          _selectedSubTab = 0;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Application approved.'), backgroundColor: CoachDashboardTheme.success),
        );
      }
      refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    }
  }

  Future<void> _reject(String id) async {
    if (id.isEmpty) return;
    final reasonController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reject Application'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Reject this coach application? The applicant will be notified and can continue as a member or reapply later.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reasonController,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Rejection reason (optional)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Reject', style: TextStyle(color: CoachDashboardTheme.danger)),
          ),
        ],
      ),
    );
    final reason = reasonController.text.trim();
    reasonController.dispose();
    if (confirmed != true) return;

    try {
      await _apiService.rejectCoachApplication(id, reason: reason);
      if (mounted) {
        setState(() {
          _applications = _applications.where((app) => app['_id']?.toString() != id).toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Application rejected.'),
            backgroundColor: CoachDashboardTheme.warning,
          ),
        );
      }
      refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ApiService.friendlyError(e)), backgroundColor: CoachDashboardTheme.danger),
        );
      }
    }
  }

  Future<void> _openRegisterCoach() async {
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => const CoachRegisterScreen(adminCreating: true),
      ),
    );
    if (result == null || !mounted) return;
    await refresh();
    if (!mounted) return;
    final user = result['user'] is Map ? Map<String, dynamic>.from(result['user'] as Map) : result;
    final name = ApiService.displayName(user);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result['message']?.toString() ?? '$name registered as a coach.'),
        backgroundColor: CoachDashboardTheme.success,
      ),
    );
  }

  Future<void> _confirmDeleteCoach(String coachId, String name) async {
    if (coachId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Coach'),
        content: Text(
          'Permanently delete $name?\n\nThis removes the coach account, classes, plans, assignments, and related records from the database. This cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: CoachDashboardTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await _apiService.deleteCoach(coachId);
      await refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$name has been deleted.'),
            backgroundColor: CoachDashboardTheme.success,
          ),
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

    if (_errorMessage != null) {
      return ScrollableCenter(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_errorMessage!, textAlign: TextAlign.center, style: const TextStyle(color: CoachDashboardTheme.danger)),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: refresh, child: const Text('Retry')),
          ],
        ),
      );
    }

    return SingleChildScrollView(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 100),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSubTabSwitcher(isDark),
          const SizedBox(height: 16),
          AdminSummaryRow(
            isDark: isDark,
            stats: [
              AdminSummaryStat(
                label: 'Total Coaches',
                value: '${_coaches.length}',
                color: CoachDashboardTheme.primary,
                icon: Icons.school_outlined,
              ),
              AdminSummaryStat(
                label: 'Pending',
                value: '${_pendingApplications.length}',
                color: CoachDashboardTheme.warning,
                icon: Icons.hourglass_top_rounded,
              ),
              AdminSummaryStat(
                label: 'Active',
                value: '$_activeCoachCount',
                color: CoachDashboardTheme.success,
                icon: Icons.verified_rounded,
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (_selectedSubTab == 0) _buildCoachesView(isDark),
          if (_selectedSubTab == 1) _buildPendingView(isDark),
        ],
      ),
    );
  }

  Widget _buildSubTabSwitcher(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _subTabButton(
            isDark: isDark,
            label: 'Active Coaches',
            count: _coaches.length,
            selected: _selectedSubTab == 0,
            onTap: () => setState(() => _selectedSubTab = 0),
          ),
          _subTabButton(
            isDark: isDark,
            label: 'Applications',
            count: _pendingApplications.length,
            selected: _selectedSubTab == 1,
            onTap: () => setState(() => _selectedSubTab = 1),
          ),
        ],
      ),
    );
  }

  Widget _subTabButton({
    required bool isDark,
    required String label,
    required int count,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
          decoration: BoxDecoration(
            color: selected ? (isDark ? CoachDashboardTheme.primary.withValues(alpha: 0.25) : Colors.white) : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: selected && !isDark ? [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 4, offset: const Offset(0, 1))] : null,
          ),
          child: Column(
            children: [
              Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? CoachDashboardTheme.primary : (isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '$count',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: selected ? CoachDashboardTheme.primary : (isDark ? Colors.white38 : Colors.grey),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPendingView(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Pending Requests', style: CoachDashboardTheme.sectionTitle(isDark)),
        const SizedBox(height: 4),
        Text(
          'Review coach applications. Rejecting permanently deletes the applicant account.',
          style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
        ),
        const SizedBox(height: 16),
        if (_pendingApplications.isEmpty)
          AdminEmptyState(
            isDark: isDark,
            icon: Icons.inbox_rounded,
            message: 'No pending requests',
            subtitle: 'New coach registration requests will appear here.',
          )
        else
          ..._pendingApplications.map((app) => _buildApplicationCard(app, isDark)),
      ],
    );
  }

  Widget _buildCoachesView(bool isDark) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Active Coaches', style: CoachDashboardTheme.sectionTitle(isDark)),
        const SizedBox(height: 4),
        Text(
          'Manage coaches who are active on the platform.',
          style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
        ),
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _openRegisterCoach,
            icon: const Icon(Icons.person_add_alt_1_rounded, size: 18),
            label: const Text('Register coach'),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          decoration: CoachDashboardTheme.searchDecoration(isDark: isDark, hint: 'Search by name or email...'),
          onChanged: (value) => setState(() {
            _coachSearchQuery = value;
            _applyCoachFilters();
          }),
        ),
        const SizedBox(height: 12),
        AdminFilterChips(
          isDark: isDark,
          labels: [
            'All (${_coaches.length})',
            'Active ($_activeCoachCount)',
            'Suspended ($_suspendedCoachCount)',
          ],
          selectedIndex: _coachStatusFilter,
          onSelected: (index) => setState(() {
            _coachStatusFilter = index;
            _applyCoachFilters();
          }),
        ),
        const SizedBox(height: 16),
        if (_coaches.isEmpty)
          AdminEmptyState(
            isDark: isDark,
            icon: Icons.school_outlined,
            message: 'No approved coaches yet',
            subtitle: 'Approve a pending application to add a coach.',
          )
        else if (_filteredCoaches.isEmpty)
          AdminEmptyState(
            isDark: isDark,
            icon: Icons.search_off_rounded,
            message: 'No coaches match your filters',
            subtitle: 'Try changing the search or status filter.',
          )
        else
          ..._filteredCoaches.map((coach) => _buildCoachCard(coach, isDark)),
      ],
    );
  }

  Widget _buildCoachCard(dynamic coach, bool isDark) {
    final map = coach is Map ? Map<dynamic, dynamic>.from(coach) : <dynamic, dynamic>{};
    final id = coach['_id']?.toString() ?? '';
    final name = ApiService.displayName(map, fallback: 'Coach');
    final email = ApiService.displayIdentity(map);
    final status = coach['status'] as String? ?? 'active';
    final suspended = status == 'suspended';
    final activeClients = (coach['activeClients'] as num?)?.toInt() ?? 0;
    final profile = coach['profile'] as Map<String, dynamic>? ?? {};
    final coachData = coach['coachData'] as Map<String, dynamic>? ?? {};
    final specs = <String>[];
    final fromCoachData = coachData['specialties'];
    final fromProfile = profile['specialization'] ?? profile['specializations'];
    if (fromCoachData is List && fromCoachData.isNotEmpty) {
      specs.addAll(fromCoachData.map((s) => s.toString()).where((s) => s.trim().isNotEmpty));
    } else if (fromProfile is List && fromProfile.isNotEmpty) {
      specs.addAll(fromProfile.map((s) => s.toString()).where((s) => s.trim().isNotEmpty));
    } else {
      final primarySpec = (coach['primarySpecialization'] ??
              profile['primarySpecialization'] ??
              coachData['primarySpecialization'] ??
              '')
          .toString()
          .trim();
      if (primarySpec.isNotEmpty) specs.add(primarySpec);
    }
    final years = profile['yearsExperience'] ?? coachData['years_experience'];
    final bio = (profile['bio'] ?? coachData['bio'] ?? '') as String;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: CoachDashboardTheme.avatarBox(initial: name.isNotEmpty ? name[0].toUpperCase() : 'C', size: 44),
          title: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16), overflow: TextOverflow.ellipsis),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(email, style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    AdminStatusBadge(
                      label: suspended ? 'Suspended' : 'Active',
                      color: suspended ? CoachDashboardTheme.danger : CoachDashboardTheme.success,
                    ),
                    if (specs.isNotEmpty)
                      AdminStatusBadge(
                        label: specs.first,
                        color: CoachDashboardTheme.primary,
                      ),
                    _coachStatChip(isDark, Icons.people_outline, '$activeClients clients'),
                    if (years != null) _coachStatChip(isDark, Icons.timeline, '$years yrs exp'),
                  ],
                ),
              ],
            ),
          ),
          children: [
            if (bio.isNotEmpty) _detailRow('Bio', bio),
            if (specs.isNotEmpty) _detailRow('Specializations', specs.join(', ')),
            if ((profile['certifications'] as String?)?.isNotEmpty == true)
              _detailRow('Certifications', profile['certifications']),
            _buildCertificateFilesSection(
              isDark,
              _certificateFilesFromApp({
                'certificateFiles': profile['certificateFiles'] ?? coachData['certificateFiles'],
                'profile': profile,
                'user': {'coachData': coachData, 'profile': profile},
              }),
            ),
            if ((profile['location'] as String?)?.isNotEmpty == true) _detailRow('Region / Gobol', profile['location']),
            if ((profile['workingDays'] as List?)?.isNotEmpty == true)
              _detailRow('Working days', (profile['workingDays'] as List).map((d) => d.toString()).join(', ')),
            if (profile['phone'] != null) _detailRow('Phone', profile['phone'].toString()),
            const SizedBox(height: 4),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: id.isEmpty
                    ? null
                    : () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => AdminMemberDetailScreen(userId: id, initialName: name),
                          ),
                        ),
                icon: const Icon(Icons.visibility_outlined, size: 18),
                label: const Text('View full profile'),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: id.isEmpty ? null : () => _confirmDeleteCoach(id, name),
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('Delete Coach'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: CoachDashboardTheme.danger,
                  side: BorderSide(color: CoachDashboardTheme.danger.withValues(alpha: 0.5)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildApplicationCard(dynamic app, bool isDark) {
    final user = app['user'] as Map<String, dynamic>? ?? {};
    final name = (user['full_name'] ?? user['name'] ?? user['username'] ?? 'Applicant').toString();
    final email = (user['username'] ?? user['email'] ?? '').toString();
    final id = app['_id']?.toString() ?? '';
    final submitted = formatAdminDate(app['createdAt']);
    final status = (app['status'] as String? ?? 'pending').toLowerCase();
    final isPending = status == 'pending';
    final statusColor = status == 'approved'
        ? CoachDashboardTheme.success
        : status == 'rejected'
            ? CoachDashboardTheme.danger
            : CoachDashboardTheme.warning;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: CoachDashboardTheme.avatarBox(initial: name.isNotEmpty ? name[0].toUpperCase() : '?', size: 40),
          title: Row(
            children: [
              Expanded(
                child: Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  status,
                  style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: statusColor),
                ),
              ),
            ],
          ),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(email, style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary)),
              if (submitted.isNotEmpty)
                Text('Submitted $submitted', style: TextStyle(fontSize: 12, color: isDark ? Colors.white38 : Colors.grey)),
            ],
          ),
          children: [
            _detailSection(isDark, 'Applicant', [
              _detailRow('First Name', (app['firstName'] ?? name.split(' ').first).toString()),
              _detailRow(
                'Last Name',
                (app['lastName'] ??
                        (name.split(' ').length > 1 ? name.split(' ').sublist(1).join(' ') : ''))
                    .toString(),
              ),
              _detailRow('Registration status', status),
            ]),
            _buildCertificateFilesSection(isDark, _certificateFilesFromApp(app)),
            _detailSection(isDark, 'Contact', [
              _detailRow('Phone', app['phone']),
              _detailRow('Age', app['age']?.toString()),
              _detailRow('Region / Gobol', app['location']),
            ]),
            _detailSection(isDark, 'Professional', [
              _detailRow('Years of Experience', app['yearsExperience']?.toString()),
              _detailRow('Certifications', app['certifications']),
              _detailRow('Specializations', app['specialization']),
              _detailRow('Working Days', (app['workingDays'] as List?)?.map((d) => d.toString()).join(', ')),
              _detailRow('Appointment Days', (app['appointmentDays'] as List?)?.map((d) => d.toString()).join(', ')),
            ]),
            _detailSection(isDark, 'Profile', [
              _detailRow('Bio', app['bio']),
              _detailRow('Work Experience', app['experience']),
              _detailRow('Motivation', app['message']),
            ]),
            const SizedBox(height: 8),
            if (user['_id'] != null)
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => AdminMemberDetailScreen(
                        userId: user['_id'].toString(),
                        initialName: name,
                      ),
                    ),
                  ),
                  icon: const Icon(Icons.visibility_outlined, size: 18),
                  label: const Text('View full profile'),
                ),
              ),
            if (isPending) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _reject(id),
                      child: const Text('Reject & delete'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      style: CoachDashboardTheme.primaryButtonStyle(),
                      onPressed: () => _approve(id),
                      child: const Text('Approve'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _coachStatChip(bool isDark, IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.12 : 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: CoachDashboardTheme.primary),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 12, color: CoachDashboardTheme.primary, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  List<Map<String, dynamic>> _certificateFilesFromApp(Map<String, dynamic> app) {
    final sources = [
      app['certificateFiles'],
      if (app['profile'] is Map) (app['profile'] as Map)['certificateFiles'],
      if (app['user'] is Map) ...[
        if ((app['user'] as Map)['coachData'] is Map)
          ((app['user'] as Map)['coachData'] as Map)['certificateFiles'],
        if ((app['user'] as Map)['profile'] is Map)
          ((app['user'] as Map)['profile'] as Map)['certificateFiles'],
      ],
    ];
    for (final source in sources) {
      if (source is! List) continue;
      final files = source
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .where((e) => (e['url']?.toString() ?? '').isNotEmpty)
          .toList();
      if (files.isNotEmpty) return files;
    }
    return [];
  }

  Widget _buildCertificateFilesSection(bool isDark, List<Map<String, dynamic>> files) {
    if (files.isEmpty) {
      return _detailSection(isDark, 'Certificate files', [
        _detailRow('Uploads', 'No certificate files uploaded'),
      ]);
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Certificate files', style: CoachDashboardTheme.sectionLabel(isDark)),
          const SizedBox(height: 8),
          SizedBox(
            height: 96,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: files.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (ctx, i) {
                final file = files[i];
                final url = file['url']?.toString() ?? '';
                final mime = file['mimeType']?.toString() ?? '';
                final name = file['fileName']?.toString() ?? 'Certificate ${i + 1}';
                final isPdf = mime.contains('pdf') || url.toLowerCase().endsWith('.pdf');
                return InkWell(
                  onTap: () async {
                    final uri = Uri.tryParse(url);
                    if (uri == null) return;
                    await launchUrl(uri, mode: LaunchMode.externalApplication);
                  },
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    width: 88,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                      color: isDark ? Colors.white10 : Colors.grey.shade100,
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: isPdf
                        ? Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.picture_as_pdf_rounded, color: CoachDashboardTheme.danger),
                              const SizedBox(height: 4),
                              Text(
                                name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                textAlign: TextAlign.center,
                                style: const TextStyle(fontSize: 10),
                              ),
                            ],
                          )
                        : Image.network(
                            url,
                            fit: BoxFit.cover,
                            width: 88,
                            height: 96,
                            errorBuilder: (_, __, ___) => const Center(
                              child: Icon(Icons.broken_image_outlined),
                            ),
                          ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Tap a file to open the full certificate',
            style: TextStyle(fontSize: 11, color: isDark ? Colors.white54 : Colors.grey),
          ),
        ],
      ),
    );
  }

  Widget _detailSection(bool isDark, String title, List<Widget> rows) {
    final visibleRows = rows.where((row) => row is! SizedBox).toList();
    if (visibleRows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: CoachDashboardTheme.sectionLabel(isDark)),
          const SizedBox(height: 6),
          ...visibleRows,
        ],
      ),
    );
  }

  Widget _detailRow(String label, dynamic value) {
    final text = value?.toString().trim() ?? '';
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)),
          Text(text, style: const TextStyle(fontSize: 14, height: 1.4)),
        ],
      ),
    );
  }
}
