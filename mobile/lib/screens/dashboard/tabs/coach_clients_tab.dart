import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../utils/async_load.dart';
import '../../../widgets/scrollable_body.dart';
import '../../../widgets/tab_refresh.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';
import '../widgets/coach_requests_panel.dart';
import 'coach_client_detail_screen.dart';

class CoachClientsTab extends StatefulWidget {
  final VoidCallback? onPendingCountChanged;
  final VoidCallback? onClientsChanged;

  const CoachClientsTab({
    super.key,
    this.onPendingCountChanged,
    this.onClientsChanged,
  });

  @override
  CoachClientsTabState createState() => CoachClientsTabState();
}

class CoachClientsTabState extends State<CoachClientsTab> with TabRefreshMixin {
  final ApiService _apiService = ApiService();
  int _selectedView = 0;
  int _pendingRequestCount = 0;
  bool _requestsViewMounted = false;
  List<dynamic> _clients = [];
  List<dynamic> _filteredClients = [];
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _fetchClients();
    _searchController.addListener(_filterClients);
  }

  void openRequestsTab() {
    if (!mounted) return;
    setState(() {
      _selectedView = 1;
      _requestsViewMounted = true;
    });
  }

  int get pendingRequestCount => _pendingRequestCount;

  Future<void> refresh() => _fetchClients(isRefresh: true);

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchClients({bool isRefresh = false}) async {
    beginTabLoad(isRefresh: isRefresh);
    try {
      final results = await waitIsolatedTimed<Object?>([
        _apiService.getCoachClients(),
        _apiService.getCoachRequests(),
      ], fallback: null);
      if (results.every((r) => r == null)) {
        finishTabError(
          Exception('Unable to load clients. Please retry.'),
          isRefresh: isRefresh,
        );
        return;
      }
      if (mounted) {
        final firstLoad = !tabHasLoadedOnce;
        final clients = results[0] is List ? List<dynamic>.from(results[0] as List) : <dynamic>[];
        final requests = results[1] is List ? List<dynamic>.from(results[1] as List) : <dynamic>[];
        finishTabLoad(() {
          final pendingCount = requests.length;
          _clients = clients;
          _filteredClients = List<dynamic>.from(clients);
          _pendingRequestCount = pendingCount;
          // Only auto-open Requests on the first load (avoids remounting the panel on every refresh).
          if (firstLoad && pendingCount > 0 && _selectedView == 0) {
            _selectedView = 1;
            _requestsViewMounted = true;
          }
        });
        widget.onPendingCountChanged?.call();
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

  void _filterClients() {
    final query = _searchController.text.toLowerCase();
    setState(() {
      _filteredClients = _clients.where((c) {
        final userMap = c['user'] is Map ? Map<dynamic, dynamic>.from(c['user'] as Map) : null;
        final name = ApiService.displayName(userMap).toLowerCase();
        final identity = ApiService.displayIdentity(userMap).toLowerCase();
        return query.isEmpty || name.contains(query) || identity.contains(query);
      }).toList();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return CoachPage(
      title: 'My Clients',
      actions: [
        IconButton(
          icon: tabRefreshIcon(color: Colors.white),
          onPressed: (showInitialLoading || tabIsRefreshing) ? null : refresh,
        ),
      ],
      body: showInitialError
              ? ScrollableCenter(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
                      const SizedBox(height: 16),
                      Text('Error: $tabLoadError', textAlign: TextAlign.center),
                      const SizedBox(height: 16),
                      ElevatedButton(onPressed: () => _fetchClients(), child: const Text('Retry')),
                    ],
                  ),
                )
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: _buildViewSwitcher(isDark),
                    ),
                    Expanded(
                      child: IndexedStack(
                        index: _selectedView,
                        children: [
                          Column(
                            children: [
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                                child: TextField(
                                  controller: _searchController,
                                  decoration: CoachDashboardTheme.searchDecoration(isDark: isDark, hint: 'Search clients...'),
                                ),
                              ),
                              Expanded(
                                child: _filteredClients.isEmpty
                                    ? CoachDashboardTheme.emptyState(
                                        icon: Icons.group_off_rounded,
                                        message: 'No clients found.',
                                        isDark: isDark,
                                      )
                                    : ListView.builder(
                                        physics: dashboardScrollPhysics,
                                        padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
                                        itemCount: _filteredClients.length,
                                        itemBuilder: (context, index) {
                                          final client = _filteredClients[index];
                                          return _ClientCard(client: client, isDark: isDark, onRefresh: () => _fetchClients(isRefresh: true));
                                        },
                                      ),
                              ),
                            ],
                          ),
                          _requestsViewMounted
                              ? CoachRequestsPanel(
                                  onRequestHandled: () {
                                    _fetchClients(isRefresh: true);
                                    widget.onPendingCountChanged?.call();
                                    widget.onClientsChanged?.call();
                                  },
                                )
                              : const SizedBox.shrink(),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildViewSwitcher(bool isDark) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          _viewButton(isDark: isDark, label: 'My Clients', count: _clients.length, selected: _selectedView == 0, onTap: () => setState(() => _selectedView = 0)),
          _viewButton(
            isDark: isDark,
            label: 'Requests',
            count: _pendingRequestCount,
            selected: _selectedView == 1,
            onTap: () => setState(() {
              _selectedView = 1;
              _requestsViewMounted = true;
            }),
          ),
        ],
      ),
    );
  }

  Widget _viewButton({
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
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: selected ? (isDark ? CoachDashboardTheme.primary.withValues(alpha: 0.25) : Colors.white) : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected ? CoachDashboardTheme.primary : (isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                ),
              ),
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

}

class _ClientCard extends StatelessWidget {
  final Map<String, dynamic> client;
  final bool isDark;
  final VoidCallback onRefresh;

  const _ClientCard({required this.client, required this.isDark, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final userMap = client['user'] is Map ? Map<dynamic, dynamic>.from(client['user'] as Map) : null;
    final name = ApiService.displayName(userMap, fallback: 'Client');
    final identity = ApiService.displayIdentity(userMap);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (context) => CoachClientDetailScreen(clientData: client),
              ),
            ).then((_) => onRefresh());
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                CoachDashboardTheme.avatarBox(
                  initial: name.isNotEmpty ? name[0].toUpperCase() : 'C',
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                          color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                        ),
                      ),
                      if (identity.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          identity,
                          style: TextStyle(
                            color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: isDark ? Colors.white38 : Colors.black38,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
