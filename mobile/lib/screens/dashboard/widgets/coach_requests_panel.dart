import 'package:flutter/material.dart';
import '../../../services/api_service.dart';
import '../../../utils/coach_specialization.dart';
import '../../../widgets/scrollable_body.dart';
import '../widgets/coach_home/coach_dashboard_theme.dart';

class CoachRequestsPanel extends StatefulWidget {
  final VoidCallback? onRequestHandled;

  const CoachRequestsPanel({super.key, this.onRequestHandled});

  @override
  State<CoachRequestsPanel> createState() => _CoachRequestsPanelState();
}

class _CoachRequestsPanelState extends State<CoachRequestsPanel> {
  final ApiService _apiService = ApiService();
  List<dynamic> _requests = [];
  bool _isLoading = true;
  String? _errorMessage;
  String? _busyRequestId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final showFullLoader = _requests.isEmpty;
    setState(() {
      if (showFullLoader) _isLoading = true;
      _errorMessage = null;
    });
    try {
      final requests = await _apiService.getCoachRequests();
      if (mounted) {
        setState(() {
          _requests = List<dynamic>.from(requests);
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString().replaceAll('Exception: ', '');
        });
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _approve(String requestId, String memberName) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        return AlertDialog(
          title: const Text('Accept request?'),
          content: Text(
            'Accept $memberName as your client? You can add them to a class afterwards from Classes.',
            style: TextStyle(height: 1.4, color: isDark ? Colors.white70 : null),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            ElevatedButton(
              style: CoachDashboardTheme.primaryButtonStyle(),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Accept Request'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;

    setState(() => _busyRequestId = requestId);
    try {
      await _apiService.approveCoachRequest(requestId);
      if (mounted) {
        setState(() {
          _busyRequestId = null;
          _requests = _requests
              .where((r) => r is! Map || r['_id']?.toString() != requestId)
              .toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('$memberName accepted. You can now add them to a class.'),
            backgroundColor: CoachDashboardTheme.success,
          ),
        );
      }
      _load();
      widget.onRequestHandled?.call();
    } catch (e) {
      if (mounted) {
        setState(() => _busyRequestId = null);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceAll('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted && _busyRequestId == requestId) {
        setState(() => _busyRequestId = null);
      }
    }
  }

  Future<void> _reject(String requestId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reject request?'),
        content: const Text('Reject this coaching request? The member will be notified.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Reject Request', style: TextStyle(color: CoachDashboardTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busyRequestId = requestId);
    try {
      await _apiService.rejectCoachRequest(requestId);
      if (mounted) {
        setState(() {
          _busyRequestId = null;
          _requests = _requests
              .where((r) => r is! Map || r['_id']?.toString() != requestId)
              .toList();
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Request rejected.'), backgroundColor: CoachDashboardTheme.warning),
        );
      }
      _load();
      widget.onRequestHandled?.call();
    } catch (e) {
      if (mounted) {
        setState(() => _busyRequestId = null);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceAll('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted && _busyRequestId == requestId) {
        setState(() => _busyRequestId = null);
      }
    }
  }

  Future<void> _viewInfo(Map<String, dynamic> request) async {
    final requestId = request['_id']?.toString() ?? request['id']?.toString() ?? '';
    if (requestId.isEmpty) return;

    Map<String, dynamic> detail = Map<String, dynamic>.from(request);
    try {
      detail = await _apiService.getCoachRequestDetail(requestId);
    } catch (_) {
      // Fall back to list payload already on the card.
    }
    if (!mounted) return;

    final user = detail['user'] is Map
        ? Map<String, dynamic>.from(detail['user'] as Map)
        : <String, dynamic>{};
    final name = ApiService.displayName(user, fallback: 'Member');

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        return _RequestInfoSheet(
          request: detail,
          user: user,
          isDark: isDark,
          isBusy: _busyRequestId == requestId,
          onAccept: () {
            Navigator.pop(ctx);
            _approve(requestId, name);
          },
          onReject: () {
            Navigator.pop(ctx);
            _reject(requestId);
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_errorMessage!, style: const TextStyle(color: CoachDashboardTheme.danger)),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_requests.isEmpty) {
      return CoachDashboardTheme.emptyState(
        icon: Icons.inbox_rounded,
        message: 'No pending requests.',
        isDark: isDark,
      );
    }

    return ListView.builder(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 100),
      itemCount: _requests.length,
      itemBuilder: (context, index) {
        final request = Map<String, dynamic>.from(_requests[index] as Map);
        final requestId = request['_id']?.toString() ?? '';
        return _RequestCard(
          request: request,
          isDark: isDark,
          isBusy: _busyRequestId == requestId,
          onViewInfo: () => _viewInfo(request),
          onApprove: () {
            final user = request['user'] as Map<String, dynamic>? ?? {};
            final name = ApiService.displayName(user, fallback: 'Member');
            _approve(requestId, name);
          },
          onReject: () => _reject(requestId),
        );
      },
    );
  }
}

String _activityLabel(dynamic level) {
  switch (level?.toString()) {
    case 'sedentary':
      return 'Sedentary';
    case 'moderate':
      return 'Moderate';
    case 'active':
      return 'Active';
    default:
      final text = level?.toString().trim() ?? '';
      return text;
  }
}

String _displayOrDash(dynamic value, {String suffix = ''}) {
  if (value == null) return 'Not specified';
  final text = value.toString().trim();
  if (text.isEmpty) return 'Not specified';
  return suffix.isEmpty ? text : '$text$suffix';
}

Map<String, dynamic> _requesterFields(Map<String, dynamic> user) {
  final clientData = user['clientData'] is Map
      ? Map<String, dynamic>.from(user['clientData'] as Map)
      : <String, dynamic>{};
  final profile = user['profile'] is Map
      ? Map<String, dynamic>.from(user['profile'] as Map)
      : <String, dynamic>{};
  final goal = fitnessGoalLabel(
        user['fitness_goal'] ?? user['fitnessGoal'] ?? clientData['fitness_goal'],
      );
  final level = _activityLabel(
        user['activity_level'] ?? user['fitness_level'] ?? clientData['activity_level'],
      );
  final experience = (user['experience'] ?? profile['experience'] ?? '').toString();
  return {
    'name': ApiService.displayName(user, fallback: 'Member'),
    'email': ApiService.displayIdentity(user),
    'phone': (user['phone'] ?? profile['phone'] ?? '').toString(),
    'photo': (user['avatar'] ?? user['photoUrl'] ?? profile['photoUrl'] ?? '').toString(),
    'fitnessGoal': goal.isNotEmpty ? goal : '',
    'fitnessLevel': level.isNotEmpty ? level : experience,
    'location': (user['location'] ?? user['region'] ?? profile['location'] ?? '').toString(),
    'age': user['age'] ?? clientData['age'] ?? profile['age'],
    'gender': (user['gender'] ?? clientData['gender'] ?? '').toString(),
    'height': user['height'] ?? clientData['height'] ?? profile['heightCm'],
    'weight': user['weight'] ?? clientData['weight'] ?? profile['weightKg'],
    'bmi': user['bmi'] ?? profile['bmi'],
    'medicalNotes': (user['medical_notes'] ?? clientData['medical_notes'] ?? '').toString(),
    'goals': user['goals'] is List
        ? List<dynamic>.from(user['goals'] as List)
        : (profile['goals'] is List ? List<dynamic>.from(profile['goals'] as List) : <dynamic>[]),
    'bio': (user['bio'] ?? profile['bio'] ?? '').toString(),
  };
}

String _formatRequestDate(dynamic value) {
  if (value == null) return '—';
  final parsed = DateTime.tryParse(value.toString())?.toLocal();
  if (parsed == null) return value.toString();
  return '${parsed.year}-${parsed.month.toString().padLeft(2, '0')}-${parsed.day.toString().padLeft(2, '0')}';
}

class _RequestCard extends StatelessWidget {
  final Map<String, dynamic> request;
  final bool isDark;
  final bool isBusy;
  final VoidCallback onViewInfo;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  const _RequestCard({
    required this.request,
    required this.isDark,
    required this.isBusy,
    required this.onViewInfo,
    required this.onApprove,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final user = request['user'] is Map
        ? Map<String, dynamic>.from(request['user'] as Map)
        : <String, dynamic>{};
    final fields = _requesterFields(user);
    final message = request['message'] as String? ?? '';
    final name = fields['name'] as String;
    final photo = fields['photo'] as String;
    final fitnessGoal = fields['fitnessGoal'] as String;
    final location = fields['location'] as String;
    final age = fields['age'];
    final gender = fields['gender'] as String;
    final fitnessLevel = fields['fitnessLevel'] as String;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _Avatar(name: name, photo: photo, size: 48),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                    const SizedBox(height: 4),
                    Text(
                      'Fitness Goal: ${_displayOrDash(fitnessGoal)}',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                    if (location.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Location: $location',
                        style: TextStyle(
                          fontSize: 13,
                          color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      'Request Status: Pending',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: CoachDashboardTheme.warning,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (age != null || gender.isNotEmpty || fitnessLevel.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (age != null) _metaChip('Age $age', isDark),
                if (gender.isNotEmpty) _metaChip(gender, isDark),
                if (fitnessLevel.isNotEmpty) _metaChip(fitnessLevel, isDark),
              ],
            ),
          ],
          if (message.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Message from member', style: CoachDashboardTheme.sectionLabel(isDark)),
            const SizedBox(height: 6),
            Text(message, style: const TextStyle(fontSize: 14, height: 1.4)),
          ],
          const SizedBox(height: 8),
          Text(
            'Requested ${_formatRequestDate(request['createdAt'])}',
            style: TextStyle(
              fontSize: 12,
              color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: isBusy ? null : onViewInfo,
                child: const Text('View Info'),
              ),
              ElevatedButton(
                style: CoachDashboardTheme.primaryButtonStyle(),
                onPressed: isBusy ? null : onApprove,
                child: isBusy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Accept'),
              ),
              OutlinedButton(
                onPressed: isBusy ? null : onReject,
                child: const Text('Reject', style: TextStyle(color: CoachDashboardTheme.danger)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metaChip(String label, bool isDark) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF222733) : const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String name;
  final String photo;
  final double size;

  const _Avatar({required this.name, required this.photo, this.size = 48});

  @override
  Widget build(BuildContext context) {
    if (photo.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(size / 2),
        child: Image.network(
          photo,
          width: size,
          height: size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => CoachDashboardTheme.avatarBox(
            initial: name.isNotEmpty ? name[0].toUpperCase() : 'U',
            size: size,
          ),
        ),
      );
    }
    return CoachDashboardTheme.avatarBox(
      initial: name.isNotEmpty ? name[0].toUpperCase() : 'U',
      size: size,
    );
  }
}

class _RequestInfoSheet extends StatelessWidget {
  final Map<String, dynamic> request;
  final Map<String, dynamic> user;
  final bool isDark;
  final bool isBusy;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  const _RequestInfoSheet({
    required this.request,
    required this.user,
    required this.isDark,
    required this.isBusy,
    required this.onAccept,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final fields = _requesterFields(user);
    final name = fields['name'] as String;
    final photo = fields['photo'] as String;
    final fitnessGoal = fields['fitnessGoal'] as String;
    final location = fields['location'] as String;
    final status = (request['status'] ?? 'pending').toString();
    final rows = <MapEntry<String, String>>[
      MapEntry('Fitness goal', _displayOrDash(fitnessGoal)),
      MapEntry('Fitness level', _displayOrDash(fields['fitnessLevel'])),
      MapEntry('Age', _displayOrDash(fields['age'])),
      MapEntry('Gender', _displayOrDash(fields['gender'])),
      MapEntry('Location / Region', _displayOrDash(location)),
      MapEntry('Height', _displayOrDash(fields['height'], suffix: ' cm')),
      MapEntry('Weight', _displayOrDash(fields['weight'], suffix: ' kg')),
      MapEntry('BMI', _displayOrDash(fields['bmi'])),
      MapEntry('Email', _displayOrDash(fields['email'])),
      MapEntry('Phone', _displayOrDash(fields['phone'])),
      MapEntry('Medical notes', _displayOrDash(fields['medicalNotes'])),
      MapEntry('Requested', _formatRequestDate(request['createdAt'])),
      MapEntry('Status', status == 'pending' ? 'Pending' : status),
    ];
    final goals = fields['goals'] as List<dynamic>;
    final bio = fields['bio'] as String;
    final message = request['message'] as String? ?? '';

    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF12151C) : Colors.white,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: isDark ? Colors.white24 : const Color(0xFFD1D5DB),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Member profile',
                        style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                  children: [
                    Row(
                      children: [
                        _Avatar(name: name, photo: photo, size: 64),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                              const SizedBox(height: 4),
                              Text(
                                'Fitness Goal: ${_displayOrDash(fitnessGoal)}',
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                              ),
                              if (location.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(
                                  location,
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (message.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text('Message', style: CoachDashboardTheme.sectionLabel(isDark)),
                      const SizedBox(height: 6),
                      Text('“$message”', style: const TextStyle(fontSize: 14, height: 1.4, fontStyle: FontStyle.italic)),
                    ],
                    const SizedBox(height: 16),
                    ...rows.map((row) {
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                row.key,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                                ),
                              ),
                            ),
                            Flexible(
                              child: Text(
                                row.value,
                                textAlign: TextAlign.right,
                                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                    if (goals.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text('Additional goals', style: CoachDashboardTheme.sectionLabel(isDark)),
                      const SizedBox(height: 6),
                      Text(goals.take(5).join(' · '), style: const TextStyle(fontSize: 14, height: 1.35)),
                    ],
                    if (bio.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text('About', style: CoachDashboardTheme.sectionLabel(isDark)),
                      const SizedBox(height: 6),
                      Text(bio, style: const TextStyle(fontSize: 14, height: 1.4)),
                    ],
                    const SizedBox(height: 20),
                    if (status == 'pending') ...[
                      ElevatedButton(
                        style: CoachDashboardTheme.primaryButtonStyle(),
                        onPressed: isBusy ? null : onAccept,
                        child: const Text('Accept Request'),
                      ),
                      const SizedBox(height: 10),
                      OutlinedButton(
                        onPressed: isBusy ? null : onReject,
                        child: const Text(
                          'Reject Request',
                          style: TextStyle(color: CoachDashboardTheme.danger),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
