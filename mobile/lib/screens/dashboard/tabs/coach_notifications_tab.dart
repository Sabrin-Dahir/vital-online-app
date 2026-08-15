import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class CoachNotificationsTab extends StatefulWidget {
  const CoachNotificationsTab({super.key});

  @override
  State<CoachNotificationsTab> createState() => _CoachNotificationsTabState();
}

class _CoachNotificationsTabState extends State<CoachNotificationsTab> {
  final ApiService _apiService = ApiService();
  bool _isLoading = true;
  List<dynamic> _notifications = [];
  String _errorMessage = '';

  @override
  void initState() {
    super.initState();
    _fetchNotifications();
  }

  Future<void> _fetchNotifications() async {
    setState(() => _isLoading = true);
    try {
      final notifications = await _apiService.getNotifications();
      if (mounted) {
        setState(() {
          _notifications = notifications;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
        });
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return CoachPage(
      title: 'Notifications',
      actions: [IconButton(icon: const Icon(Icons.refresh_rounded), onPressed: _fetchNotifications)],
      body: _isLoading
          ? const ScrollableCenter(child: CircularProgressIndicator())
          : _errorMessage.isNotEmpty
              ? ScrollableCenter(child: Text('Error: $_errorMessage'))
              : _notifications.isEmpty
          ? CoachDashboardTheme.emptyState(
              icon: Icons.notifications_off_outlined,
              message: 'You have no notifications.',
              isDark: isDark,
            )
          : ListView.builder(
              physics: dashboardScrollPhysics,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 100),
              itemCount: _notifications.length,
              itemBuilder: (context, index) {
                final notif = _notifications[index];
                final message = notif['message'] ?? 'New notification';
                final type = notif['type'] ?? 'info';
                
                IconData icon;
                Color iconColor;

                switch (type) {
                  case 'workout':
                    icon = Icons.fitness_center_rounded;
                    iconColor = CoachDashboardTheme.primary;
                    break;
                  case 'alert':
                  case 'update':
                    icon = Icons.warning_rounded;
                    iconColor = CoachDashboardTheme.danger;
                    break;
                  case 'success':
                  case 'tip':
                    icon = Icons.check_circle_rounded;
                    iconColor = CoachDashboardTheme.success;
                    break;
                  case 'reminder':
                    icon = Icons.event_rounded;
                    iconColor = CoachDashboardTheme.warning;
                    break;
                  case 'info':
                  case 'system':
                  default:
                    icon = Icons.info_rounded;
                    iconColor = CoachDashboardTheme.accent;
                    break;
                }

                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: CoachDashboardTheme.cardDecoration(isDark),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    leading: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: iconColor.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(icon, color: iconColor, size: 20),
                    ),
                    title: Text(
                      message,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                      ),
                    ),
                    subtitle: Text(
                      notif['createdAt'] != null
                          ? DateTime.parse(notif['createdAt']).toLocal().toString().split('.')[0]
                          : 'Just now',
                      style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
                    ),
                  ),
                );
              },
            ),
    );
  }
}
