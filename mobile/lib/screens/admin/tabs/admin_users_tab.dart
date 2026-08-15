import 'package:flutter/material.dart';
import '../../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import '../../../models/user_model.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../../auth/register_screen.dart';
import '../widgets/admin_management_widgets.dart';
import '../screens/admin_member_detail_screen.dart';

class AdminUsersTab extends StatefulWidget {
  final User adminUser;

  const AdminUsersTab({super.key, required this.adminUser});

  @override
  AdminUsersTabState createState() => AdminUsersTabState();
}

class AdminUsersTabState extends State<AdminUsersTab> {
  final ApiService _apiService = ApiService();
  List<dynamic> _users = [];
  List<dynamic> _filteredUsers = [];
  bool _isLoading = true;
  String? _errorMessage;
  String _searchQuery = '';
  int _statusFilter = 0;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  Future<void> refresh() async {
    final showFullLoader = _users.isEmpty;
    setState(() {
      if (showFullLoader) _isLoading = true;
      _errorMessage = null;
    });
    try {
      final users = await _apiService.getUsers(role: 'user');
      if (mounted) {
        setState(() {
          _users = List.from(users).where((u) => (u['role'] as String? ?? '') == 'user').toList();
          _applyFilters();
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

  void _applyFilters() {
    Iterable<dynamic> list = _users;
    if (_statusFilter == 1) {
      list = list.where((u) => (u['status'] as String? ?? 'active') == 'active');
    } else if (_statusFilter == 2) {
      list = list.where((u) => u['status'] == 'suspended');
    }
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      list = list.where((u) {
        final map = u is Map ? Map<dynamic, dynamic>.from(u) : null;
        final name = ApiService.displayName(map).toLowerCase();
        final identity = ApiService.displayIdentity(map).toLowerCase();
        return name.contains(q) || identity.contains(q);
      });
    }
    _filteredUsers = list.toList()
      ..sort((a, b) {
        final an = ApiService.displayName(a is Map ? Map<dynamic, dynamic>.from(a) : null);
        final bn = ApiService.displayName(b is Map ? Map<dynamic, dynamic>.from(b) : null);
        return an.compareTo(bn);
      });
  }

  Future<void> _openRegisterClient() async {
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(
        builder: (_) => const RegisterScreen(adminCreating: true),
      ),
    );
    if (result == null || !mounted) return;
    await refresh();
    if (!mounted) return;
    final user = result['user'] is Map ? Map<String, dynamic>.from(result['user'] as Map) : result;
    final name = ApiService.displayName(user);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(result['message']?.toString() ?? '$name registered as a client.'),
        backgroundColor: CoachDashboardTheme.success,
      ),
    );
  }

  int get _activeCount => _users.where((u) => (u['status'] as String? ?? 'active') == 'active').length;
  int get _suspendedCount => _users.where((u) => u['status'] == 'suspended').length;

  Future<void> _confirmDeleteUser(String userId, String name) async {
    if (userId.isEmpty) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete User'),
        content: Text(
          'Are you sure you want to delete this user?\n\nPermanently delete $name? This removes their account and related data from the database. This cannot be undone.',
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
      await _apiService.deleteUser(userId);
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
          AdminSummaryRow(
            isDark: isDark,
            stats: [
              AdminSummaryStat(
                label: 'Total Users',
                value: '${_users.length}',
                color: CoachDashboardTheme.primary,
                icon: Icons.people_alt_rounded,
              ),
              AdminSummaryStat(
                label: 'Active',
                value: '$_activeCount',
                color: CoachDashboardTheme.success,
                icon: Icons.check_circle_outline_rounded,
              ),
              AdminSummaryStat(
                label: 'Suspended',
                value: '$_suspendedCount',
                color: CoachDashboardTheme.danger,
                icon: Icons.block_rounded,
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text('Users', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 4),
          Text(
            'View registration details from the app. You can delete a member account; editing profiles is not allowed.',
            style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _openRegisterClient,
              icon: const Icon(Icons.person_add_alt_1_rounded, size: 18),
              label: const Text('Register client'),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: CoachDashboardTheme.searchDecoration(isDark: isDark, hint: 'Search by name or email...'),
            onChanged: (value) => setState(() {
              _searchQuery = value;
              _applyFilters();
            }),
          ),
          const SizedBox(height: 12),
          AdminFilterChips(
            isDark: isDark,
            labels: ['All (${_users.length})', 'Active ($_activeCount)', 'Suspended ($_suspendedCount)'],
            selectedIndex: _statusFilter,
            onSelected: (index) => setState(() {
              _statusFilter = index;
              _applyFilters();
            }),
          ),
          const SizedBox(height: 16),
          if (_users.isEmpty)
            AdminEmptyState(
              isDark: isDark,
              icon: Icons.people_outline_rounded,
              message: 'No users registered yet',
              subtitle: 'Member signups will appear here once users create accounts.',
            )
          else if (_filteredUsers.isEmpty)
            AdminEmptyState(
              isDark: isDark,
              icon: Icons.search_off_rounded,
              message: 'No users match your filters',
              subtitle: 'Try changing the search or status filter.',
            )
          else
            ..._filteredUsers.map((user) => _buildUserCard(user, isDark)),
        ],
      ),
    );
  }

  Widget _buildUserCard(dynamic user, bool isDark) {
    final map = user is Map ? Map<dynamic, dynamic>.from(user) : <dynamic, dynamic>{};
    final id = user['_id']?.toString() ?? '';
    final name = ApiService.displayName(map, fallback: 'Unnamed');
    final username = (user['username'] ?? '').toString();
    final clientData = user['clientData'] as Map<String, dynamic>? ?? {};
    final phone = (user['phone'] ?? '').toString();
    final gender = (clientData['gender'] ?? '').toString();
    final age = clientData['age'];
    final height = clientData['height'];
    final weight = clientData['weight'];
    final fitnessGoal = _fitnessGoalLabel(clientData['fitness_goal']?.toString());
    final joined = formatAdminDate(user['createdAt']);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          leading: CoachDashboardTheme.avatarBox(
            initial: name.isNotEmpty ? name[0].toUpperCase() : '?',
            size: 44,
          ),
          title: Text(
            name,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              username.isNotEmpty ? '@$username' : phone,
              style: TextStyle(fontSize: 13, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
            ),
          ),
          children: [
            if (phone.isNotEmpty) _detailRow('Phone', phone),
            if (gender.isNotEmpty) _detailRow('Gender', gender),
            if (age != null) _detailRow('Age', age.toString()),
            if (height != null) _detailRow('Height', '$height cm'),
            if (weight != null) _detailRow('Weight', '$weight kg'),
            if (fitnessGoal.isNotEmpty) _detailRow('Fitness goal', fitnessGoal),
            _detailRow('Registered', joined),
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
                label: const Text('View registration details'),
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: id.isEmpty ? null : () => _confirmDeleteUser(id, name),
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('Delete User'),
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

  String _fitnessGoalLabel(String? goal) {
    switch (goal) {
      case 'lose_weight':
        return 'Lose weight';
      case 'gain_muscle':
        return 'Gain muscle';
      case 'maintain':
        return 'Maintain';
      case 'other':
        return 'General';
      default:
        return goal ?? '';
    }
  }

  Widget _detailRow(String label, String value) {
    if (value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)),
          Text(value, style: const TextStyle(fontSize: 14, height: 1.4)),
        ],
      ),
    );
  }
}
