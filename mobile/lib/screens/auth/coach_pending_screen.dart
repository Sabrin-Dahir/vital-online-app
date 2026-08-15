import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';
import '../../widgets/scrollable_body.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import 'auth_home.dart';
import 'coach_register_screen.dart';
import 'coach_rejected_screen.dart';
import 'login_screen.dart';

class CoachPendingScreen extends StatefulWidget {
  final User user;

  const CoachPendingScreen({super.key, required this.user});

  @override
  State<CoachPendingScreen> createState() => _CoachPendingScreenState();
}

class _CoachPendingScreenState extends State<CoachPendingScreen> {
  final ApiService _apiService = ApiService();
  bool _isRefreshing = false;
  String? _errorMessage;
  String? _statusFeedback;
  User? _approvedUser;
  late User _currentUser;
  Timer? _pollTimer;
  DateTime? _lastCheckedAt;
  List<Map<String, dynamic>> _certificateFiles = [];

  bool get _isApproved => _approvedUser?.hasApprovedCoachApplication == true;

  @override
  void initState() {
    super.initState();
    _currentUser = widget.user;
    _refreshStatus(silent: true);
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!_isApproved && mounted) _refreshStatus(silent: true);
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  void _openCoachDashboard() {
    final user = _approvedUser;
    if (user == null) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => AuthHome(user: user)),
      (_) => false,
    );
  }

  Future<void> _openRegistration({required bool viewOnly}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CoachRegisterScreen(
          existingUser: _currentUser,
          viewOnly: viewOnly,
        ),
      ),
    );
    if (!mounted) return;
    await _refreshStatus(silent: true);
  }

  Future<({User? user, List<Map<String, dynamic>> certificates})> _fetchLatest() async {
    final user = await _apiService.getMe();
    if (user == null) {
      return (user: null, certificates: const <Map<String, dynamic>>[]);
    }

    try {
      final application = await _apiService.getMyCoachApplication();
      if (application == null) {
        return (user: user, certificates: _certificateFiles);
      }

      final appStatus = application['status']?.toString();
      final reviewedRaw = application['reviewedAt']?.toString();
      final reviewedAt = reviewedRaw != null ? DateTime.tryParse(reviewedRaw) : null;

      final files = application['certificateFiles'];
      final certificates = files is List
          ? files
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .where((e) => (e['url']?.toString() ?? '').isNotEmpty)
              .toList()
          : <Map<String, dynamic>>[];

      return (
        user: user.copyWith(
          coachApplicationStatus: appStatus ?? user.coachApplicationStatus,
          coachApplicationReviewedAt: reviewedAt ?? user.coachApplicationReviewedAt,
        ),
        certificates: certificates,
      );
    } catch (_) {
      return (user: user, certificates: _certificateFiles);
    }
  }

  void _showStatusFeedback(String message, {bool success = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: success ? CoachDashboardTheme.success : CoachDashboardTheme.warning,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _refreshStatus({bool silent = false}) async {
    setState(() {
      _isRefreshing = true;
      _errorMessage = null;
      if (!silent) _statusFeedback = null;
    });

    try {
      final latest = await _fetchLatest();
      final user = latest.user;
      if (!mounted) return;

      if (user == null) {
        setState(() {
          _errorMessage = 'Could not refresh status. Check your connection and try again.';
        });
        return;
      }

      final checkedAt = DateTime.now();

      if (user.hasApprovedCoachApplication) {
        setState(() {
          _approvedUser = user;
          _currentUser = user;
          _certificateFiles = latest.certificates;
          _errorMessage = null;
          _lastCheckedAt = checkedAt;
          _statusFeedback = 'Your application has been approved.';
        });
        if (!silent) _showStatusFeedback('Approved! You can open your coach dashboard.');
        return;
      }

      if (user.hasRejectedCoachApplication) {
        if (!silent) _showStatusFeedback('Your application was not approved.', success: false);
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => CoachRejectedScreen(user: user)),
        );
        return;
      }

      if (!user.hasPendingCoachApplication) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => AuthHome(user: user)),
        );
        return;
      }

      setState(() {
        _currentUser = user;
        _approvedUser = null;
        _certificateFiles = latest.certificates;
        _lastCheckedAt = checkedAt;
        _statusFeedback = 'Your application is still pending admin review.';
      });
      if (!silent) {
        _showStatusFeedback('Status: Pending — under admin review.', success: false);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = ApiService.friendlyError(e);
        });
      }
    } finally {
      if (mounted) setState(() => _isRefreshing = false);
    }
  }

  Future<void> _logout() async {
    await _apiService.clearAuth();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  String _joinList(List<String> values) =>
      values.map((v) => v.trim()).where((v) => v.isNotEmpty).join(', ');

  String _formatDayAvailability(List<dynamic> days) {
    final parts = <String>[];
    for (final raw in days) {
      if (raw is! Map) continue;
      final day = raw['day']?.toString() ?? '';
      if (day.isEmpty) continue;
      final start = raw['start']?.toString() ?? '';
      final end = raw['end']?.toString() ?? '';
      parts.add('$day ${start.isNotEmpty || end.isNotEmpty ? '$start–$end' : ''}'.trim());
    }
    return parts.join(', ');
  }

  Widget _profileRow(String label, String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(text, style: const TextStyle(fontSize: 14, height: 1.4)),
        ],
      ),
    );
  }

  Widget _statusBadge(bool isDark) {
    final status = _isApproved ? 'Approved' : _currentUser.coachApplicationStatusLabel;
    final Color color;
    final IconData icon;
    switch (status.toLowerCase()) {
      case 'approved':
        color = CoachDashboardTheme.success;
        icon = Icons.check_circle_outline_rounded;
        break;
      case 'rejected':
        color = CoachDashboardTheme.danger;
        icon = Icons.cancel_outlined;
        break;
      default:
        color = CoachDashboardTheme.warning;
        icon = Icons.hourglass_top_rounded;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 10),
              Text(
                'Application status: $status',
                style: TextStyle(fontWeight: FontWeight.w700, color: color, fontSize: 15),
              ),
            ],
          ),
          if (_lastCheckedAt != null) ...[
            const SizedBox(height: 6),
            Text(
              'Last checked ${DateFormat('MMM d, h:mm a').format(_lastCheckedAt!.toLocal())}',
              style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary),
            ),
          ],
          if (_statusFeedback != null && !_isApproved) ...[
            const SizedBox(height: 6),
            Text(
              _statusFeedback!,
              style: TextStyle(fontSize: 13, height: 1.4, color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary),
            ),
          ],
        ],
      ),
    );
  }

  Widget _submittedProfileCard(bool isDark) {
    final profile = _currentUser.profile;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your submitted profile', style: CoachDashboardTheme.sectionLabel(isDark)),
          const SizedBox(height: 10),
          _profileRow('Name', _currentUser.name),
          _profileRow('Email', _currentUser.email),
          _profileRow('Phone', profile?.phone),
          _profileRow('Region / Gobol', profile?.location),
          _profileRow('Age', profile?.age?.toString()),
          _profileRow('Years experience', profile?.yearsExperience?.toString()),
          _profileRow('Specialization', _joinList(profile?.specialization ?? const [])),
          _profileRow('Certifications', _joinList(profile?.certifications ?? const [])),
          _profileRow('Working days', _joinList(profile?.workingDays ?? const [])),
          _profileRow('Appointment days', _joinList(profile?.appointmentDays ?? const [])),
          _profileRow(
            'Appointment duration',
            profile?.appointmentDurationMinutes != null
                ? '${profile!.appointmentDurationMinutes} min'
                : null,
          ),
          _profileRow(
            'Day availability',
            _formatDayAvailability(profile?.dayAvailability ?? const []),
          ),
          _profileRow('Experience', profile?.experience),
          _profileRow('Bio', profile?.bio),
          if (_certificateFiles.isNotEmpty) ...[
            const SizedBox(height: 6),
            const Text(
              'Certificate files',
              style: TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: 88,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _certificateFiles.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (ctx, i) {
                  final file = _certificateFiles[i];
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
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      width: 80,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
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
                                Text(name, maxLines: 2, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center, style: const TextStyle(fontSize: 9)),
                              ],
                            )
                          : Image.network(
                              url,
                              fit: BoxFit.cover,
                              width: 80,
                              height: 88,
                              errorBuilder: (_, __, ___) => const Center(child: Icon(Icons.broken_image_outlined)),
                            ),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            physics: dashboardScrollPhysics,
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: (_isApproved ? CoachDashboardTheme.success : CoachDashboardTheme.warning)
                          .withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _isApproved ? Icons.check_circle_rounded : Icons.hourglass_top_rounded,
                      size: 56,
                      color: _isApproved ? CoachDashboardTheme.success : CoachDashboardTheme.warning,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    _isApproved ? 'Application Approved!' : 'Application Under Review',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    _isApproved
                        ? 'Congratulations ${_currentUser.name}! Your coach application has been approved. '
                            'Tap the button below to open your coach dashboard.'
                        : 'Hi ${_currentUser.name}, your coach application has been submitted. '
                            'Review your profile details below while an admin decides.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15,
                      height: 1.5,
                      color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 24),
                  _statusBadge(isDark),
                  const SizedBox(height: 16),
                  if (!_isApproved) ...[
                    _submittedProfileCard(isDark),
                    const SizedBox(height: 16),
                  ],
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: CoachDashboardTheme.cardDecoration(isDark),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _isApproved ? 'You are ready to coach' : 'What happens next?',
                          style: CoachDashboardTheme.sectionLabel(isDark),
                        ),
                        const SizedBox(height: 8),
                        if (_isApproved) ...[
                          _step('1', 'Your profile is now visible to app members'),
                          _step('2', 'Open your coach dashboard to manage clients and classes'),
                          _step('3', 'Check notifications for any updates from admin'),
                        ] else ...[
                          _step('1', 'Admin reviews your credentials and experience'),
                          _step('2', 'You receive an in-app and email notification with the decision'),
                          _step('3', 'Once approved, an "Open Coach Dashboard" button will appear here'),
                        ],
                      ],
                    ),
                  ),
                  if (_errorMessage != null) ...[
                    const SizedBox(height: 16),
                    Text(
                      _errorMessage!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: CoachDashboardTheme.danger),
                    ),
                  ],
                  const SizedBox(height: 24),
                  if (_isApproved) ...[
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        style: CoachDashboardTheme.primaryButtonStyle(),
                        onPressed: _openCoachDashboard,
                        icon: const Icon(Icons.dashboard_rounded, color: Colors.white),
                        label: const Text('Open Coach Dashboard'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _openRegistration(viewOnly: true),
                        icon: const Icon(Icons.description_outlined),
                        label: const Text('View Registration'),
                      ),
                    ),
                  ] else ...[
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        style: CoachDashboardTheme.primaryButtonStyle(),
                        onPressed: _isRefreshing ? null : () => _refreshStatus(),
                        child: const Text('Check Status'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _openRegistration(viewOnly: true),
                        icon: const Icon(Icons.description_outlined),
                        label: const Text('View Registration'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: _logout,
                    child: const Text('Sign Out'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _step(String number, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$number.', style: const TextStyle(fontWeight: FontWeight.bold, color: CoachDashboardTheme.primary)),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }
}
