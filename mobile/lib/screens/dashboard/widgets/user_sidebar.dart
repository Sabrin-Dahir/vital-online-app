import 'package:flutter/material.dart';

import '../../../models/user_model.dart';
import 'coach_home/coach_dashboard_theme.dart';

class UserSidebar extends StatelessWidget {
  final User user;
  final VoidCallback onOpenAppointments;
  final VoidCallback onOpenSessions;
  final VoidCallback onOpenWorkouts;
  final VoidCallback onOpenAttendance;
  final VoidCallback onOpenNotifications;

  const UserSidebar({
    super.key,
    required this.user,
    required this.onOpenAppointments,
    required this.onOpenSessions,
    required this.onOpenWorkouts,
    required this.onOpenAttendance,
    required this.onOpenNotifications,
  });

  void _push(BuildContext context, VoidCallback action) {
    Navigator.pop(context);
    action();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final initial = user.name.isNotEmpty ? user.name[0].toUpperCase() : 'U';

    return Drawer(
      backgroundColor: CoachDashboardTheme.drawerBackground(isDark),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(topRight: Radius.circular(16), bottomRight: Radius.circular(16)),
      ),
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(20, 52, 20, 24),
            decoration: const BoxDecoration(gradient: CoachDashboardTheme.headerGradient),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    initial,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                      color: CoachDashboardTheme.primary,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  user.name,
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                Text(
                  user.email,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'MEMBER',
                    style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(vertical: 8),
              children: [
                _drawerLabel('TOOLS', isDark),
                _buildDrawerPush(
                  context,
                  Icons.event_available_rounded,
                  'Appointments',
                  isDark,
                  () => _push(context, onOpenAppointments),
                ),
                _buildDrawerPush(
                  context,
                  Icons.people_alt_rounded,
                  '1-on-1 Sessions',
                  isDark,
                  () => _push(context, onOpenSessions),
                ),
                _buildDrawerPush(
                  context,
                  Icons.assignment_rounded,
                  'My Workouts',
                  isDark,
                  () => _push(context, onOpenWorkouts),
                ),
                _buildDrawerPush(
                  context,
                  Icons.fact_check_rounded,
                  'My Attendance',
                  isDark,
                  () => _push(context, onOpenAttendance),
                ),
                _buildDrawerPush(
                  context,
                  Icons.notifications_rounded,
                  'Notifications',
                  isDark,
                  () => _push(context, onOpenNotifications),
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _drawerLabel(String text, bool isDark) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
      child: Text(text, style: CoachDashboardTheme.sectionLabel(isDark)),
    );
  }

  Widget _buildDrawerPush(
    BuildContext context,
    IconData icon,
    String title,
    bool isDark,
    VoidCallback onTap,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 1),
      child: ListTile(
        dense: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        leading: Icon(icon, size: 20, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
        title: Text(
          title,
          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
        ),
        trailing: Icon(Icons.chevron_right_rounded, size: 18, color: isDark ? Colors.white24 : Colors.black26),
        onTap: onTap,
      ),
    );
  }
}
