import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';
import '../../utils/password_utils.dart';
import '../../utils/field_validation.dart';
import '../../utils/somalia_regions.dart';
import '../../utils/coach_specialization.dart';
import '../../widgets/scrollable_body.dart';
import '../dashboard/widgets/coach_home/coach_dashboard_theme.dart';
import 'auth_home.dart';
import 'login_screen.dart';
import '../../services/coach_application_prefs.dart';

class _PendingCertificate {
  final String fileName;
  final String mimeType;
  final String dataUrl;
  final Uint8List bytes;
  /// CDN URL after upload + name validation (preferred on submit).
  final String? uploadedUrl;
  final String? uploadedAt;

  const _PendingCertificate({
    required this.fileName,
    required this.mimeType,
    required this.dataUrl,
    required this.bytes,
    this.uploadedUrl,
    this.uploadedAt,
  });

  bool get isImage => mimeType.startsWith('image/');

  Map<String, dynamic> toPayload() {
    final remote = (uploadedUrl ?? '').trim();
    if (remote.isNotEmpty) {
      return {
        'fileName': fileName,
        'mimeType': mimeType,
        'url': remote,
        if (uploadedAt != null && uploadedAt!.isNotEmpty) 'uploadedAt': uploadedAt,
      };
    }
    return {
      'fileName': fileName,
      'mimeType': mimeType,
      'dataUrl': dataUrl,
    };
  }
}

class _DayHours {
  TimeOfDay start;
  TimeOfDay end;

  _DayHours({
    required this.start,
    required this.end,
  });
}

class CoachRegisterScreen extends StatefulWidget {
  final User? existingUser;
  /// When true, show saved registration details without editing/submitting.
  final bool viewOnly;
  /// Admin fills the same coach registration flow; does not sign in as the new coach.
  final bool adminCreating;

  const CoachRegisterScreen({
    super.key,
    this.existingUser,
    this.viewOnly = false,
    this.adminCreating = false,
  });

  @override
  State<CoachRegisterScreen> createState() => _CoachRegisterScreenState();
}

class _CoachRegisterScreenState extends State<CoachRegisterScreen> {
  final _apiService = ApiService();
  final _pageController = PageController();
  int _currentStep = 0;
  bool _isSubmitting = false;
  bool _validatingCertificates = false;
  String? _errorMessage;
  bool _obscurePassword = true;

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _phoneController = TextEditingController();
  final _ageController = TextEditingController();
  final _locationController = TextEditingController();
  final _yearsExperienceController = TextEditingController();
  final _certificationsController = TextEditingController();
  final _specializationController = TextEditingController();
  String? _selectedSpecialization;
  final Set<String> _selectedSpecializations = {};
  static const _specializationOptions = [
    'General Fitness',
    'Weight Loss',
    'Weight Gain',
    'Nutrition',
    'Muscle Building',
    'Strength Training',
    'Bodybuilding',
    'Cardio & Endurance',
    'HIIT',
    'Functional Training',
    'Personal Training',
    'Fitness for Beginners',
    "Women's Fitness",
    "Men's Fitness",
    'Senior Fitness',
    'Youth Fitness',
    'Sports Training',
    'Athletic Performance',
    'Flexibility & Mobility',
    'Yoga & Mindfulness',
    'Posture & Corrective Exercise',
    'Injury Prevention',
    'Rehabilitation & Recovery',
    'Pre/Postnatal Fitness',
    'Lifestyle & Wellness',
    'Meal Planning',
    'Healthy Eating',
    'Weight Management',
  ];
  final _bioController = TextEditingController();
  final _experienceController = TextEditingController();
  final _messageController = TextEditingController();
  final _picker = ImagePicker();
  final List<_PendingCertificate> _certificates = [];
  final List<Map<String, dynamic>> _existingCertificateFiles = [];
  static const int _maxCertificates = 5;
  static const int _maxCertBytes = 2 * 1024 * 1024;
  bool _loadingSaved = false;
  String? _rejectionReason;

  late final List<String> _stepTitles;
  late final bool _isReapply;

  static const _weekdays = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  final Set<String> _selectedWorkingDays = {};
  final Set<String> _selectedAppointmentDays = {};
  final Map<String, _DayHours> _dayAvailability = {};

  int _appointmentDuration = 60;
  static const List<int> _durationOptions = [30, 45, 60];

  bool get _isViewOnly => widget.viewOnly;
  bool get _isReturningApplicant => widget.existingUser != null;
  bool get _canEdit => !_isViewOnly;

  @override
  void initState() {
    super.initState();
    // Returning applicants (view or reapply) skip the account creation step.
    _isReapply = _isReturningApplicant;
    _stepTitles = _isReapply
        ? ['Personal Info', 'Professional', 'Appointment Days', 'About You', 'Review']
        : ['Account', 'Personal Info', 'Professional', 'Appointment Days', 'About You', 'Review'];

    if (_isReturningApplicant) {
      final user = widget.existingUser!;
      _nameController.text = user.name;
      _emailController.text = user.email;
      _loadSavedApplication();
    }
  }

  TimeOfDay _parseHm(String? raw, {int hour = 9, int minute = 0}) {
    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch((raw ?? '').trim());
    if (match == null) return TimeOfDay(hour: hour, minute: minute);
    return TimeOfDay(
      hour: int.parse(match.group(1)!).clamp(0, 23),
      minute: int.parse(match.group(2)!).clamp(0, 59),
    );
  }

  Future<void> _loadSavedApplication() async {
    setState(() => _loadingSaved = true);
    try {
      final application = await _apiService.getMyCoachApplication();
      final user = widget.existingUser;
      if (!mounted) return;

      if (application != null) {
        final reason = application['rejectionReason']?.toString().trim() ?? '';
        _rejectionReason = reason.isEmpty ? null : reason;
        _phoneController.text = (application['phone'] ?? user?.profile?.phone ?? '').toString();
        final age = application['age'] ?? user?.profile?.age;
        if (age != null) _ageController.text = age.toString();
        final savedLocation =
            (application['location'] ?? user?.profile?.location ?? '').toString();
        _locationController.text =
            SomaliaRegions.match(savedLocation) ?? '';
        // Keep legacy non-region values visible only until coach re-selects a region.
        if (_locationController.text.isEmpty && savedLocation.trim().isNotEmpty) {
          // Leave empty so the dropdown forces a valid region pick.
          _locationController.text = '';
        }
        final years = application['yearsExperience'] ?? user?.profile?.yearsExperience;
        if (years != null) _yearsExperienceController.text = years.toString();
        _certificationsController.text = (application['certifications'] ?? '').toString();
        if (_certificationsController.text.trim().isEmpty &&
            user?.profile?.certifications.isNotEmpty == true) {
          _certificationsController.text = user!.profile!.certifications.join(', ');
        }
        _specializationController.text = (application['specialization'] ?? '').toString();
        if (_specializationController.text.trim().isEmpty &&
            user?.profile?.specialization.isNotEmpty == true) {
          _specializationController.text = user!.profile!.specialization.join(', ');
        }
        _syncSpecializationSelection(_specializationController.text);
        _bioController.text = (application['bio'] ?? user?.profile?.bio ?? '').toString();
        _experienceController.text =
            (application['experience'] ?? user?.profile?.experience ?? '').toString();
        _messageController.text = (application['message'] ?? '').toString();

        final working = application['workingDays'];
        _selectedWorkingDays
          ..clear()
          ..addAll((working is List ? working : const [])
              .map((e) => e.toString())
              .where((d) => _weekdays.contains(d)));
        if (_selectedWorkingDays.isEmpty && user?.profile?.workingDays.isNotEmpty == true) {
          _selectedWorkingDays.addAll(user!.profile!.workingDays.where(_weekdays.contains));
        }

        final appointment = application['appointmentDays'];
        _selectedAppointmentDays
          ..clear()
          ..addAll((appointment is List ? appointment : const [])
              .map((e) => e.toString())
              .where((d) => _weekdays.contains(d)));
        if (_selectedAppointmentDays.isEmpty &&
            user?.profile?.appointmentDays.isNotEmpty == true) {
          _selectedAppointmentDays
              .addAll(user!.profile!.appointmentDays.where(_weekdays.contains));
        }

        final duration =
            application['appointmentDurationMinutes'] ?? user?.profile?.appointmentDurationMinutes;
        if (duration is num) {
          final d = duration.toInt();
          if (_durationOptions.contains(d)) _appointmentDuration = d;
        }

        _dayAvailability.clear();
        final dayAvail =
            application['dayAvailability'] ?? user?.profile?.dayAvailability ?? const [];
        if (dayAvail is List) {
          for (final entry in dayAvail) {
            if (entry is! Map) continue;
            final day = entry['day']?.toString() ?? '';
            if (!_weekdays.contains(day)) continue;
            _dayAvailability[day] = _DayHours(
              start: _parseHm(entry['start']?.toString()),
              end: _parseHm(entry['end']?.toString(), hour: 17),
            );
            _selectedAppointmentDays.add(day);
          }
        }
        for (final day in _selectedAppointmentDays) {
          _dayAvailability.putIfAbsent(
            day,
            () => _DayHours(
              start: const TimeOfDay(hour: 9, minute: 0),
              end: const TimeOfDay(hour: 17, minute: 0),
            ),
          );
        }

        final files = application['certificateFiles'];
        _existingCertificateFiles
          ..clear()
          ..addAll(
            (files is List ? files : const [])
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .where((e) => (e['url']?.toString() ?? '').isNotEmpty),
          );
        if (_existingCertificateFiles.isEmpty && user?.profile?.certificateFiles.isNotEmpty == true) {
          _existingCertificateFiles.addAll(user!.profile!.certificateFiles);
        }
      } else if (user?.profile != null) {
        final profile = user!.profile!;
        _phoneController.text = profile.phone ?? '';
        if (profile.age != null) _ageController.text = profile.age.toString();
        final profileLocation = profile.location ?? '';
        _locationController.text =
            SomaliaRegions.match(profileLocation) ?? '';
        if (profile.yearsExperience != null) {
          _yearsExperienceController.text = profile.yearsExperience.toString();
        }
        _certificationsController.text = profile.certifications.join(', ');
        _specializationController.text = profile.specialization.join(', ');
        _syncSpecializationSelection(_specializationController.text);
        _bioController.text = profile.bio ?? '';
        _experienceController.text = profile.experience ?? '';
        _existingCertificateFiles
          ..clear()
          ..addAll(profile.certificateFiles);
        _selectedWorkingDays
          ..clear()
          ..addAll(profile.workingDays.where(_weekdays.contains));
        _selectedAppointmentDays
          ..clear()
          ..addAll(profile.appointmentDays.where(_weekdays.contains));
        if (profile.appointmentDurationMinutes != null &&
            _durationOptions.contains(profile.appointmentDurationMinutes)) {
          _appointmentDuration = profile.appointmentDurationMinutes!;
        }
        for (final entry in profile.dayAvailability) {
          if (entry is! Map) continue;
          final day = entry['day']?.toString() ?? '';
          if (!_weekdays.contains(day)) continue;
          _dayAvailability[day] = _DayHours(
            start: _parseHm(entry['start']?.toString()),
            end: _parseHm(entry['end']?.toString(), hour: 17),
          );
          _selectedAppointmentDays.add(day);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = ApiService.friendlyError(e));
      }
    } finally {
      if (mounted) setState(() => _loadingSaved = false);
    }
  }

  void _syncSpecializationSelection(String raw) {
    _selectedSpecializations
      ..clear()
      ..addAll(
        raw
            .split(',')
            .map((part) => part.trim())
            .where((part) => _specializationOptions.contains(part)),
      );
    // Legacy single values
    if (_selectedSpecializations.isEmpty) {
      final lower = raw.trim().toLowerCase();
      if (lower.contains('nutrition')) _selectedSpecializations.add('Nutrition');
      if (lower.contains('weight loss')) _selectedSpecializations.add('Weight Loss');
      if (lower == 'general' || lower.contains('general fitness')) {
        _selectedSpecializations.add('General Fitness');
      }
    }
    _selectedSpecialization =
        _selectedSpecializations.isEmpty ? null : _selectedSpecializations.first;
    _specializationController.text = _selectedSpecializations.join(', ');
  }

  void _toggleSpecialization(String option) {
    final selecting = !_selectedSpecializations.contains(option);
    final error = specializationToggleError(
      current: _selectedSpecializations,
      option: option,
      selecting: selecting,
    );
    if (error != null) {
      _showError(error);
      return;
    }
    setState(() {
      if (selecting) {
        if (option == 'General Fitness') {
          _selectedSpecializations
            ..clear()
            ..add('General Fitness');
        } else {
          _selectedSpecializations.add(option);
        }
      } else {
        _selectedSpecializations.remove(option);
      }
      _selectedSpecialization =
          _selectedSpecializations.isEmpty ? null : _selectedSpecializations.first;
      _specializationController.text = _selectedSpecializations.join(', ');
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _phoneController.dispose();
    _ageController.dispose();
    _locationController.dispose();
    _yearsExperienceController.dispose();
    _certificationsController.dispose();
    _specializationController.dispose();
    _bioController.dispose();
    _experienceController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  int get _accountStepIndex => _isReapply ? -1 : 0;
  int get _personalStepIndex => _isReapply ? 0 : 1;
  int get _professionalStepIndex => _isReapply ? 1 : 2;
  int get _availabilityStepIndex => _isReapply ? 2 : 3;
  int get _aboutStepIndex => _isReapply ? 3 : 4;

  bool _validateCurrentStep() {
    if (_currentStep == _accountStepIndex) {
      final nameError = validateFullName(_nameController.text);
      if (nameError != null) return _showError(nameError);
      final emailError = validateEmail(_emailController.text);
      if (emailError != null) return _showError(emailError);
      final passwordError = PasswordUtils.validatePassword(_passwordController.text);
      if (passwordError != null) return _showError(passwordError);
      return true;
    }
    if (_currentStep == _personalStepIndex) {
      if (_phoneController.text.trim().isEmpty) return _showError('Phone number is required');
      final digits = _phoneController.text.replaceAll(RegExp(r'\D'), '');
      if (digits.length < 7 || digits.length > 15) {
        return _showError('Please enter a valid phone number');
      }
      final age = int.tryParse(_ageController.text.trim());
      if (age == null || age < 18 || age > 120) {
        return _showError('Age must be between 18 and 120 years.');
      }
      final locationError = SomaliaRegions.validate(_locationController.text);
      if (locationError != null) return _showError(locationError);
      return true;
    }
    if (_currentStep == _professionalStepIndex) {
      final years = int.tryParse(_yearsExperienceController.text.trim());
      if (years == null || years < 0) return _showError('Enter valid years of experience');
      if (_certificationsController.text.trim().isEmpty) {
        return _showError('List your certifications');
      }
      if (_certificates.isEmpty && _existingCertificateFiles.isEmpty) {
        return _showError(
          'Upload at least one certificate photo (JPG or PNG) that clearly shows your first and last name',
        );
      }
      if (_selectedSpecializations.isEmpty) {
        return _showError('Please select at least one specialization.');
      }
      final specializationError =
          validateSpecializationSelection(_selectedSpecializations.toList());
      if (specializationError != null) return _showError(specializationError);
      if (_selectedWorkingDays.isEmpty) {
        return _showError('Select at least one working day');
      }
      return true;
    }
    if (_currentStep == _availabilityStepIndex) {
      if (_orderedAppointmentDays.isEmpty) {
        return _showError('Select at least one appointment day');
      }
      for (final day in _orderedAppointmentDays) {
        final hours = _dayAvailability[day];
        if (hours == null) {
          return _showError('Set working hours for $day');
        }
        final startMinutes = hours.start.hour * 60 + hours.start.minute;
        final endMinutes = hours.end.hour * 60 + hours.end.minute;
        if (endMinutes <= startMinutes) {
          return _showError('$day: end time must be after the start time');
        }
        if (endMinutes - startMinutes < _appointmentDuration) {
          return _showError('$day: working hours must fit at least one appointment slot');
        }
      }
      return true;
    }
    if (_currentStep == _aboutStepIndex) {
      // Bio / experience / motivation: any length allowed (short or detailed).
      return true;
    }
    return true;
  }

  bool _showError(String message) {
    setState(() => _errorMessage = message);
    return false;
  }

  List<String> get _orderedWorkingDays =>
      _weekdays.where((day) => _selectedWorkingDays.contains(day)).toList();

  List<String> get _orderedAppointmentDays =>
      _weekdays.where((day) => _selectedAppointmentDays.contains(day)).toList();

  void _toggleWorkingDay(String day) {
    if (!_canEdit) return;
    setState(() {
      if (_selectedWorkingDays.contains(day)) {
        _selectedWorkingDays.remove(day);
      } else {
        _selectedWorkingDays.add(day);
      }
    });
  }

  void _toggleAppointmentDay(String day) {
    if (!_canEdit) return;
    setState(() {
      if (_selectedAppointmentDays.contains(day)) {
        _selectedAppointmentDays.remove(day);
        _dayAvailability.remove(day);
      } else {
        _selectedAppointmentDays.add(day);
        _dayAvailability.putIfAbsent(
          day,
          () => _DayHours(
            start: const TimeOfDay(hour: 9, minute: 0),
            end: const TimeOfDay(hour: 17, minute: 0),
          ),
        );
      }
    });
  }

  List<Map<String, String>> get _dayAvailabilityPayload =>
      _orderedAppointmentDays.map((day) {
        final hours = _dayAvailability[day]!;
        return {
          'day': day,
          'start': _hhmm(hours.start),
          'end': _hhmm(hours.end),
        };
      }).toList();

  Widget _buildWorkingDaysSection(bool isDark) {
    final selected = _orderedWorkingDays;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Working Days', style: CoachDashboardTheme.sectionTitle(isDark)),
        const SizedBox(height: 6),
        Text(
          'Select the days you actively coach or work with clients. This is your general coaching schedule.',
          style: TextStyle(fontSize: 13, color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
        ),
        const SizedBox(height: 14),
        LayoutBuilder(
          builder: (context, constraints) {
            final useTwoColumns = constraints.maxWidth >= 360;
            if (useTwoColumns) {
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _weekdays
                    .map((day) => _workingDayChip(day, isDark, width: (constraints.maxWidth - 10) / 2))
                    .toList(),
              );
            }
            return Column(
              children: _weekdays
                  .map((day) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _workingDayChip(day, isDark),
                      ))
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 12),
        if (selected.isEmpty)
          Text(
            'Select at least one working day to continue.',
            style: TextStyle(fontSize: 12, color: CoachDashboardTheme.warning.withValues(alpha: 0.9)),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: CoachDashboardTheme.success.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: CoachDashboardTheme.success.withValues(alpha: 0.25)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${selected.length} working day${selected.length == 1 ? '' : 's'} selected',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: selected
                      .map((day) => Chip(
                            label: Text(day),
                            avatar: const Icon(Icons.check_circle_rounded, size: 16, color: CoachDashboardTheme.success),
                            backgroundColor: CoachDashboardTheme.success.withValues(alpha: 0.1),
                            side: BorderSide(color: CoachDashboardTheme.success.withValues(alpha: 0.3)),
                          ))
                      .toList(),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildAppointmentDaysSelection(bool isDark) {
    final selected = _orderedAppointmentDays;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Appointment Days', style: CoachDashboardTheme.sectionTitle(isDark)),
        const SizedBox(height: 6),
        Text(
          'Choose the days when members can book appointments with you. '
          'This is separate from your working days — pick any combination that fits your availability.',
          style: TextStyle(fontSize: 13, color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
        ),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.08 : 0.04),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: CoachDashboardTheme.primary.withValues(alpha: 0.2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.info_outline_rounded, size: 16, color: CoachDashboardTheme.primary),
                  const SizedBox(width: 8),
                  Text(
                    'Examples',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Monday only · Monday, Wednesday & Friday · Saturday & Sunday · any custom mix',
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        LayoutBuilder(
          builder: (context, constraints) {
            final useTwoColumns = constraints.maxWidth >= 360;
            if (useTwoColumns) {
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: _weekdays
                    .map((day) => _appointmentDayChip(day, isDark, width: (constraints.maxWidth - 10) / 2))
                    .toList(),
              );
            }
            return Column(
              children: _weekdays
                  .map((day) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _appointmentDayChip(day, isDark),
                      ))
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 12),
        if (selected.isEmpty)
          Text(
            'Select at least one appointment day to continue.',
            style: TextStyle(fontSize: 12, color: CoachDashboardTheme.warning.withValues(alpha: 0.9)),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: CoachDashboardTheme.success.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: CoachDashboardTheme.success.withValues(alpha: 0.25)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${selected.length} appointment day${selected.length == 1 ? '' : 's'} selected',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: isDark ? Colors.white70 : CoachDashboardTheme.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: selected
                      .map((day) => Chip(
                            label: Text(day),
                            avatar: const Icon(Icons.check_circle_rounded, size: 16, color: CoachDashboardTheme.success),
                            backgroundColor: CoachDashboardTheme.success.withValues(alpha: 0.1),
                            side: BorderSide(color: CoachDashboardTheme.success.withValues(alpha: 0.3)),
                          ))
                      .toList(),
                ),
                const SizedBox(height: 6),
                Text(
                  'Members can only book on these days. Unselected days will not be available.',
                  style: TextStyle(
                    fontSize: 11,
                    color: isDark ? Colors.white54 : CoachDashboardTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _workingDayChip(String day, bool isDark, {double? width}) {
    final selected = _selectedWorkingDays.contains(day);
    final chip = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _toggleWorkingDay(day),
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: selected
                ? CoachDashboardTheme.primary.withValues(alpha: 0.12)
                : (isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB)),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? CoachDashboardTheme.primary
                  : (isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB)),
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                size: 20,
                color: selected ? CoachDashboardTheme.primary : (isDark ? Colors.white38 : CoachDashboardTheme.textSecondary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  day,
                  style: TextStyle(
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected
                        ? CoachDashboardTheme.primary
                        : (isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (width == null) return chip;
    return SizedBox(width: width, child: chip);
  }

  Widget _appointmentDayChip(String day, bool isDark, {double? width}) {
    final selected = _selectedAppointmentDays.contains(day);
    final chip = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _toggleAppointmentDay(day),
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: selected
                ? CoachDashboardTheme.primary.withValues(alpha: 0.12)
                : (isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB)),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? CoachDashboardTheme.primary
                  : (isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB)),
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                size: 20,
                color: selected ? CoachDashboardTheme.primary : (isDark ? Colors.white38 : CoachDashboardTheme.textSecondary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  day,
                  style: TextStyle(
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected
                        ? CoachDashboardTheme.primary
                        : (isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    if (width == null) return chip;
    return SizedBox(width: width, child: chip);
  }

  void _nextStep() {
    setState(() => _errorMessage = null);
    if (!_isViewOnly && !_validateCurrentStep()) return;

    if (_currentStep < _stepTitles.length - 1) {
      setState(() => _currentStep++);
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _submit();
    }
  }

  void _previousStep() {
    if (_currentStep == 0) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _currentStep--;
      _errorMessage = null;
    });
    _pageController.previousPage(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }

  Future<void> _submit() async {
    if (_isViewOnly) {
      if (mounted) Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final payload = {
        'phone': _phoneController.text.trim(),
        'age': int.parse(_ageController.text.trim()),
        'location': SomaliaRegions.match(_locationController.text) ??
            _locationController.text.trim(),
        'yearsExperience': int.parse(_yearsExperienceController.text.trim()),
        'certifications': _certificationsController.text.trim(),
        'specialization': _selectedSpecializations.toList(),
        'bio': _bioController.text.trim(),
        'experience': _experienceController.text.trim(),
        'message': _messageController.text.trim(),
        'workingDays': _orderedWorkingDays,
        'appointmentDays': _orderedAppointmentDays,
        'dayAvailability': _dayAvailabilityPayload,
        'appointmentDurationMinutes': _appointmentDuration,
        'certificateFiles': [
          ..._existingCertificateFiles.map((e) => {
                'url': e['url'],
                'fileName': e['fileName'] ?? '',
                'mimeType': e['mimeType'] ?? '',
                'uploadedAt': e['uploadedAt'],
              }),
          ..._certificates.map((c) => c.toPayload()),
        ],
      };

      final User user;
      if (_isReapply) {
        await CoachApplicationPrefs.clearRejectionDismissed(widget.existingUser!.id);
        await _apiService.submitCoachApplication(
          phone: payload['phone'] as String,
          age: payload['age'] as int,
          location: payload['location'] as String,
          yearsExperience: payload['yearsExperience'] as int,
          certifications: payload['certifications'] as String,
          specialization: payload['specialization'],
          bio: payload['bio'] as String,
          experience: payload['experience'] as String,
          message: payload['message'] as String,
          workingDays: payload['workingDays'] as List<String>,
          appointmentDays: payload['appointmentDays'] as List<String>,
          dayAvailability: (payload['dayAvailability'] as List)
              .map((e) => Map<String, String>.from(e as Map))
              .toList(),
          appointmentDurationMinutes: payload['appointmentDurationMinutes'] as int,
          certificateFiles: (payload['certificateFiles'] as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList(),
        );
        final latest = await _apiService.getMe();
        user = latest ??
            widget.existingUser!.copyWith(
              coachApplicationStatus: 'pending',
              coachApplicationReviewedAt: null,
            );
      } else if (widget.adminCreating) {
        final created = await _apiService.createAdminUser(
          name: _nameController.text.trim(),
          email: _emailController.text.trim(),
          password: _passwordController.text,
          role: 'coach',
          phone: payload['phone'] as String,
          age: payload['age'] as int,
          location: payload['location'] as String,
          yearsExperience: payload['yearsExperience'] as int,
          certifications: payload['certifications'] as String,
          specialization: payload['specialization'],
          bio: payload['bio'] as String,
          experience: payload['experience'] as String,
          message: payload['message'] as String,
          workingDays: payload['workingDays'] as List<String>,
          appointmentDays: payload['appointmentDays'] as List<String>,
          dayAvailability: (payload['dayAvailability'] as List)
              .map((e) => Map<String, String>.from(e as Map))
              .toList(),
          appointmentDurationMinutes: payload['appointmentDurationMinutes'] as int,
          certificateFiles: (payload['certificateFiles'] as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList(),
        );
        if (!mounted) return;
        Navigator.of(context).pop(created);
        return;
      } else {
        user = await _apiService.registerCoach(
          name: _nameController.text.trim(),
          email: _emailController.text.trim(),
          password: _passwordController.text,
          phone: payload['phone'] as String,
          age: payload['age'] as int,
          location: payload['location'] as String,
          yearsExperience: payload['yearsExperience'] as int,
          certifications: payload['certifications'] as String,
          specialization: payload['specialization'],
          bio: payload['bio'] as String,
          experience: payload['experience'] as String,
          message: payload['message'] as String,
          workingDays: payload['workingDays'] as List<String>,
          appointmentDays: payload['appointmentDays'] as List<String>,
          dayAvailability: (payload['dayAvailability'] as List)
              .map((e) => Map<String, String>.from(e as Map))
              .toList(),
          appointmentDurationMinutes: payload['appointmentDurationMinutes'] as int,
          certificateFiles: (payload['certificateFiles'] as List)
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList(),
        );
      }

      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => AuthHome(user: user)),
        (_) => false,
      );
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = ApiService.friendlyError(e));
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: CoachDashboardTheme.homeBackground(isDark),
      appBar: AppBar(
        title: Text(
          _isViewOnly
              ? 'Your Registration'
              : (_isReapply ? 'Update Application' : 'Coach Registration'),
        ),
        backgroundColor: CoachDashboardTheme.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        actions: [
          if (_currentStep < _stepTitles.length - 1)
            IconButton(
              tooltip: 'Next step',
              onPressed: _isSubmitting ? null : _nextStep,
              icon: const Icon(Icons.arrow_forward_rounded),
            ),
        ],
      ),
      body: Column(
        children: [
          _buildStepIndicator(isDark),
          if (_errorMessage != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: CoachDashboardTheme.danger.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _errorMessage!,
                    style: const TextStyle(color: CoachDashboardTheme.danger),
                  ),
                  if (_errorMessage!.toLowerCase().contains('already registered') ||
                      _errorMessage!.toLowerCase().contains('sign in')) ...[
                    const SizedBox(height: 10),
                    TextButton(
                      onPressed: () {
                        Navigator.of(context).pushAndRemoveUntil(
                          MaterialPageRoute(builder: (_) => const LoginScreen()),
                          (_) => false,
                        );
                      },
                      child: const Text('Go to Sign In'),
                    ),
                  ],
                ],
              ),
            ),
          if (_loadingSaved)
            const SizedBox.shrink(),
          Expanded(
            child: PageView(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                if (!_isReapply) _buildAccountStep(isDark),
                _buildPersonalStep(isDark),
                _buildProfessionalStep(isDark),
                _buildAppointmentAvailabilityStep(isDark),
                _buildAboutStep(isDark),
                _buildReviewStep(isDark),
              ],
            ),
          ),
          _buildNavigationBar(isDark),
        ],
      ),
    );
  }

  Widget _buildStepIndicator(bool isDark) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      color: isDark ? const Color(0xFF181B24) : Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Step ${_currentStep + 1} of ${_stepTitles.length}: ${_stepTitles[_currentStep]}',
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
          ),
          const SizedBox(height: 10),
          Row(
            children: List.generate(_stepTitles.length, (index) {
              final active = index <= _currentStep;
              return Expanded(
                child: Container(
                  height: 4,
                  margin: EdgeInsets.only(right: index < _stepTitles.length - 1 ? 6 : 0),
                  decoration: BoxDecoration(
                    color: active ? CoachDashboardTheme.primary : Colors.grey.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationBar(bool isDark) {
    final isLastStep = _currentStep == _stepTitles.length - 1;
    if (_isViewOnly) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF181B24) : Colors.white,
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, -2))],
        ),
        child: Row(
          children: [
            if (_currentStep > 0)
              Expanded(
                child: OutlinedButton(
                  onPressed: _previousStep,
                  child: const Text('Back'),
                ),
              ),
            if (_currentStep > 0) const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: ElevatedButton(
                style: CoachDashboardTheme.primaryButtonStyle(),
                onPressed: _loadingSaved
                    ? null
                    : (isLastStep ? () => Navigator.of(context).maybePop() : _nextStep),
                child: Text(isLastStep ? 'Back to Status' : 'Continue'),
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF181B24) : Colors.white,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 8, offset: const Offset(0, -2))],
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: _isSubmitting ? null : _previousStep,
              child: Text(_currentStep == 0 ? 'Cancel' : 'Back'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: ElevatedButton(
              style: CoachDashboardTheme.primaryButtonStyle(),
              onPressed: _isSubmitting || _loadingSaved ? null : _nextStep,
              child: Text(isLastStep ? (_isReapply ? 'Resubmit Application' : 'Submit Application') : 'Continue'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stepScroll({required Widget child}) {
    return SingleChildScrollView(
      physics: dashboardScrollPhysics,
      padding: const EdgeInsets.all(20),
      child: child,
    );
  }

  InputDecoration _fieldDecoration(String label, {String? hint, IconData? icon}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: icon != null ? Icon(icon) : null,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildAccountStep(bool isDark) {
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Create your account', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          Text(
            'Start with your login credentials. You will access the coach dashboard after admin approval.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _nameController,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => setState(() {}),
            decoration: _fieldDecoration('Full Name *', icon: Icons.person_outline).copyWith(
              errorText: _nameController.text.trim().isEmpty
                  ? null
                  : validateFullName(_nameController.text),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            enableSuggestions: !widget.adminCreating,
            autofillHints: widget.adminCreating
                ? const []
                : const [AutofillHints.email],
            onChanged: (_) => setState(() {}),
            decoration: _fieldDecoration('Email Address *', icon: Icons.email_outlined).copyWith(
              errorText: _emailController.text.trim().isEmpty
                  ? null
                  : validateEmail(_emailController.text),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _passwordController,
            obscureText: _obscurePassword,
            enableSuggestions: false,
            autofillHints: widget.adminCreating
                ? const []
                : const [AutofillHints.newPassword],
            decoration: _fieldDecoration('Password *', icon: Icons.lock_outline).copyWith(
              suffixIcon: IconButton(
                icon: Icon(_obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPersonalStep(bool isDark) {
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Personal information', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          Text(
            'This information is reviewed by admins and kept private from other coaches.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _phoneController,
            readOnly: !_canEdit,
            keyboardType: TextInputType.phone,
            decoration: _fieldDecoration('Phone Number *', icon: Icons.phone_outlined),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _ageController,
            readOnly: !_canEdit,
            keyboardType: TextInputType.number,
            decoration: _fieldDecoration('Age *', hint: 'Must be 18+', icon: Icons.cake_outlined),
          ),
          const SizedBox(height: 16),
          _buildSomaliaRegionDropdown(isDark),
        ],
      ),
    );
  }

  Widget _buildSomaliaRegionDropdown(bool isDark) {
    final selected = SomaliaRegions.match(_locationController.text);
    final displayRaw = _locationController.text.trim();

    if (!_canEdit) {
      return InputDecorator(
        decoration: _fieldDecoration('Region / Gobol *', icon: Icons.location_on_outlined),
        child: Text(
          (selected ?? displayRaw).isNotEmpty ? (selected ?? displayRaw) : '—',
          style: TextStyle(
            fontSize: 16,
            color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
          ),
        ),
      );
    }

    return DropdownButtonFormField<String>(
      value: selected,
      isExpanded: true,
      menuMaxHeight: 360,
      decoration: _fieldDecoration(
        'Region / Gobol *',
        hint: 'Select Somali region',
        icon: Icons.location_on_outlined,
      ),
      items: SomaliaRegions.all
          .map(
            (region) => DropdownMenuItem<String>(
              value: region,
              child: Text(region, overflow: TextOverflow.ellipsis),
            ),
          )
          .toList(),
      onChanged: (region) {
        if (region == null) return;
        setState(() => _locationController.text = region);
      },
    );
  }

  String get _expectedCertificateName {
    final fromForm = _nameController.text.trim();
    if (fromForm.isNotEmpty) return fromForm;
    final user = widget.existingUser;
    return (user?.name ?? user?.email ?? '').trim();
  }

  Future<void> _pickCertificates() async {
    final already = _certificates.length + _existingCertificateFiles.length;
    if (already >= _maxCertificates) {
      _showError('You can upload at most $_maxCertificates certificates');
      return;
    }

    final expectedName = _expectedCertificateName;
    if (expectedName.isEmpty) {
      _showError('Enter your full name first, then upload a certificate that shows that name.');
      return;
    }

    try {
      final remaining = _maxCertificates - already;
      final files = await _picker.pickMultiImage(
        imageQuality: 85,
        maxWidth: 2000,
      );
      if (files.isEmpty) return;

      if (!mounted) return;
      setState(() {
        _validatingCertificates = true;
        _errorMessage = null;
      });

      final additions = <_PendingCertificate>[];
      String? lastError;
      for (final file in files.take(remaining)) {
        final bytes = await file.readAsBytes();
        if (bytes.length > _maxCertBytes) {
          lastError = '${file.name} exceeds the 2 MB limit';
          continue;
        }
        final lower = file.name.toLowerCase();
        String mime = 'image/jpeg';
        if (lower.endsWith('.png')) {
          mime = 'image/png';
        } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
          mime = 'image/jpeg';
        } else if (lower.endsWith('.webp')) {
          mime = 'image/webp';
        } else {
          mime = 'image/jpeg';
        }

        if (mime == 'image/webp') {
          lastError = '${file.name}: use JPG or PNG so your name can be verified';
          continue;
        }

        final localName = file.name.isNotEmpty ? file.name : 'certificate.jpg';
        final dataUrl = 'data:$mime;base64,${base64Encode(bytes)}';
        Map<String, dynamic> validated;
        try {
          // Backend uploads to ImageKit first, then OCR-checks the uploaded image.
          validated = await _apiService.validateCoachCertificate(
            dataUrl: dataUrl,
            expectedName: expectedName,
            fileName: localName,
          );
        } catch (e) {
          lastError = ApiService.friendlyError(e);
          continue;
        }

        final remoteUrl = validated['url']?.toString().trim() ?? '';
        if (remoteUrl.isEmpty) {
          lastError = 'Certificate upload did not return a file URL. Try again.';
          continue;
        }

        additions.add(
          _PendingCertificate(
            fileName: validated['fileName']?.toString().trim().isNotEmpty == true
                ? validated['fileName'].toString()
                : localName,
            mimeType: validated['mimeType']?.toString().trim().isNotEmpty == true
                ? validated['mimeType'].toString()
                : mime,
            dataUrl: dataUrl,
            bytes: bytes,
            uploadedUrl: remoteUrl,
            uploadedAt: validated['uploadedAt']?.toString(),
          ),
        );
      }

      if (!mounted) return;
      setState(() {
        if (additions.isNotEmpty) {
          _certificates.addAll(additions);
          _errorMessage = lastError;
        } else {
          _errorMessage = lastError ??
              'Certificate rejected. Upload a clear photo that shows your first and last name ($expectedName).';
        }
      });
    } catch (e) {
      if (mounted) {
        _showError('Could not pick certificates. Try again.');
      }
    } finally {
      if (mounted) setState(() => _validatingCertificates = false);
    }
  }

  void _removeCertificate(int index) {
    setState(() {
      _certificates.removeAt(index);
      _errorMessage = null;
    });
  }

  Widget _buildCertificateUploadSection(bool isDark) {
    final totalCount = _certificates.length + _existingCertificateFiles.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _isViewOnly ? 'Certificate files' : 'Certificate Upload *',
          style: CoachDashboardTheme.sectionTitle(isDark),
        ),
        const SizedBox(height: 6),
        Text(
          _isViewOnly
              ? 'Certificates submitted with your application.'
              : 'Upload a clear JPG/PNG of your certificate. Your first and last name must be visible on the document (like a fitness trainer certificate), max 2 MB each, up to $_maxCertificates.',
          style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary, fontSize: 13),
        ),
        const SizedBox(height: 12),
        if (totalCount > 0)
          SizedBox(
            height: 110,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: totalCount,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (ctx, i) {
                final isExisting = i < _existingCertificateFiles.length;
                if (isExisting) {
                  final file = _existingCertificateFiles[i];
                  final url = file['url']?.toString() ?? '';
                  final mime = file['mimeType']?.toString() ?? '';
                  final isPdf = mime.contains('pdf') || url.toLowerCase().endsWith('.pdf');
                  return Stack(
                    children: [
                      Container(
                        width: 100,
                        height: 110,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                          color: isDark ? Colors.white10 : Colors.grey.shade100,
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: isPdf
                            ? const Center(child: Icon(Icons.picture_as_pdf_rounded, size: 36))
                            : Image.network(
                                url,
                                fit: BoxFit.cover,
                                width: 100,
                                height: 110,
                                errorBuilder: (_, __, ___) =>
                                    const Center(child: Icon(Icons.broken_image_outlined)),
                              ),
                      ),
                      if (_canEdit)
                        Positioned(
                          top: 4,
                          right: 4,
                          child: Material(
                            color: Colors.black54,
                            shape: const CircleBorder(),
                            child: InkWell(
                              customBorder: const CircleBorder(),
                              onTap: () => setState(() => _existingCertificateFiles.removeAt(i)),
                              child: const Padding(
                                padding: EdgeInsets.all(4),
                                child: Icon(Icons.close, size: 16, color: Colors.white),
                              ),
                            ),
                          ),
                        ),
                    ],
                  );
                }
                final cert = _certificates[i - _existingCertificateFiles.length];
                final newIndex = i - _existingCertificateFiles.length;
                return Stack(
                  children: [
                    Container(
                      width: 100,
                      height: 110,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: isDark ? Colors.white12 : Colors.black12),
                        color: isDark ? Colors.white10 : Colors.grey.shade100,
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: cert.isImage
                          ? Image.memory(cert.bytes, fit: BoxFit.cover, width: 100, height: 110)
                          : const Center(child: Icon(Icons.picture_as_pdf_rounded, size: 36)),
                    ),
                    if (_canEdit)
                      Positioned(
                        top: 4,
                        right: 4,
                        child: Material(
                          color: Colors.black54,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: () => _removeCertificate(newIndex),
                            child: const Padding(
                              padding: EdgeInsets.all(4),
                              child: Icon(Icons.close, size: 16, color: Colors.white),
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        if (totalCount > 0) const SizedBox(height: 12),
        if (_canEdit) ...[
          OutlinedButton.icon(
            onPressed: (totalCount >= _maxCertificates || _validatingCertificates)
                ? null
                : _pickCertificates,
            icon: const Icon(Icons.upload_file_rounded),
            label: Text(
              (totalCount == 0 ? 'Upload certificates' : 'Add more certificates'),
            ),
          ),
          if (totalCount > 0)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                '$totalCount / $_maxCertificates uploaded',
                style: TextStyle(fontSize: 12, color: isDark ? Colors.white54 : Colors.grey),
              ),
            ),
        ] else if (totalCount == 0)
          Text(
            'No certificate files on file.',
            style: TextStyle(color: isDark ? Colors.white54 : Colors.grey),
          ),
      ],
    );
  }

  Widget _buildProfessionalStep(bool isDark) {
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Professional credentials', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          Text(
            'Share your training background so admins can verify your qualifications.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _yearsExperienceController,
            readOnly: !_canEdit,
            keyboardType: TextInputType.number,
            decoration: _fieldDecoration('Years of Experience *', icon: Icons.timeline),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _certificationsController,
            readOnly: !_canEdit,
            maxLines: 3,
            decoration: _fieldDecoration(
              'Certifications *',
              hint: 'e.g. NASM-CPT, ACE, CPR/AED',
              icon: Icons.verified_outlined,
            ),
          ),
          const SizedBox(height: 20),
          _buildCertificateUploadSection(isDark),
          const SizedBox(height: 16),
          Text(
            'Specializations *',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Select one or more specialized options, or General Fitness alone (it cannot be combined).',
            style: TextStyle(
              fontSize: 12,
              color: isDark ? Colors.white70 : Colors.black54,
            ),
          ),
          const SizedBox(height: 10),
          Container(
            constraints: const BoxConstraints(maxHeight: 280),
            decoration: BoxDecoration(
              border: Border.all(color: isDark ? Colors.white24 : Colors.black12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: ListView(
              shrinkWrap: true,
              children: _specializationOptions.map((option) {
                final selected = _selectedSpecializations.contains(option);
                final generalSelected = _selectedSpecializations.contains('General Fitness');
                final othersSelected =
                    _selectedSpecializations.any((item) => item != 'General Fitness');
                final disabled = !selected &&
                    ((generalSelected && option != 'General Fitness') ||
                        (option == 'General Fitness' && othersSelected));
                return CheckboxListTile(
                  dense: true,
                  value: selected,
                  title: Text(
                    option,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: disabled
                          ? (isDark ? Colors.white38 : Colors.black38)
                          : null,
                    ),
                  ),
                  controlAffinity: ListTileControlAffinity.leading,
                  onChanged: (!_canEdit || disabled)
                      ? null
                      : (_) => _toggleSpecialization(option),
                );
              }).toList(),
            ),
          ),
          if (_selectedSpecializations.contains('General Fitness')) ...[
            const SizedBox(height: 8),
            Text(
              'General Fitness is exclusive. Remove it before selecting other specializations.',
              style: TextStyle(
                fontSize: 12,
                color: isDark ? Colors.white70 : Colors.black54,
              ),
            ),
          ],
          if (_selectedSpecializations.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              'Selected Specializations:',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            ..._selectedSpecializations.map(
              (item) => Padding(
                padding: const EdgeInsets.only(left: 8, top: 2),
                child: Text('• $item'),
              ),
            ),
          ],
          const SizedBox(height: 24),
          _buildWorkingDaysSection(isDark),
        ],
      ),
    );
  }

  String _formatTime(TimeOfDay time) => time.format(context);

  String _hhmm(TimeOfDay time) =>
      '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

  Future<void> _pickTimeForDay(String day, {required bool isStart}) async {
    if (!_canEdit) return;
    final hours = _dayAvailability[day];
    if (hours == null) return;
    final picked = await showTimePicker(
      context: context,
      initialTime: isStart ? hours.start : hours.end,
      helpText: isStart ? 'Start time for $day' : 'End time for $day',
    );
    if (picked == null) return;
    setState(() {
      if (isStart) {
        hours.start = picked;
      } else {
        hours.end = picked;
      }
      _errorMessage = null;
    });
  }

  Widget _buildAppointmentAvailabilityStep(bool isDark) {
    final days = _orderedAppointmentDays;
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Appointment Days', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          Text(
            'Choose which days accept bookings, then set start and end times for each selected day.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 22),
          _buildAppointmentDaysSelection(isDark),
          const SizedBox(height: 24),
          if (days.isNotEmpty) ...[
            Text('Hours per day', style: CoachDashboardTheme.sectionLabel(isDark)),
            const SizedBox(height: 10),
            ...days.map((day) => _dayAvailabilityCard(day, isDark)),
            const SizedBox(height: 24),
          ],
          Text('Appointment Duration', style: CoachDashboardTheme.sectionLabel(isDark)),
          const SizedBox(height: 10),
          Row(
            children: _durationOptions
                .map((minutes) => Expanded(
                      child: Padding(
                        padding: EdgeInsets.only(right: minutes == _durationOptions.last ? 0 : 10),
                        child: _durationChip(isDark, minutes),
                      ),
                    ))
                .toList(),
          ),
          const SizedBox(height: 26),
          _availabilityPreviewCard(isDark),
        ],
      ),
    );
  }

  Widget _dayAvailabilityCard(String day, bool isDark) {
    final hours = _dayAvailability[day];
    if (hours == null) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.calendar_today_rounded, size: 18, color: CoachDashboardTheme.primary),
              const SizedBox(width: 8),
              Text(day, style: CoachDashboardTheme.sectionLabel(isDark)),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _timePickerTile(
                  isDark: isDark,
                  label: 'Start Time',
                  value: _formatTime(hours.start),
                  onTap: () => _pickTimeForDay(day, isStart: true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _timePickerTile(
                  isDark: isDark,
                  label: 'End Time',
                  value: _formatTime(hours.end),
                  onTap: () => _pickTimeForDay(day, isStart: false),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _timePickerTile({
    required bool isDark,
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: isDark ? Colors.white38 : CoachDashboardTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(Icons.schedule_rounded, size: 18, color: CoachDashboardTheme.primary),
                  const SizedBox(width: 8),
                  Text(value, style: _appointmentValueStyle(isDark)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _durationChip(bool isDark, int minutes) {
    final selected = _appointmentDuration == minutes;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _canEdit ? () => setState(() => _appointmentDuration = minutes) : null,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: selected
                ? CoachDashboardTheme.primary.withValues(alpha: 0.12)
                : (isDark ? const Color(0xFF0F1117) : const Color(0xFFF9FAFB)),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? CoachDashboardTheme.primary
                  : (isDark ? const Color(0xFF2A2F3D) : const Color(0xFFE5E7EB)),
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Center(
            child: Text(
              '$minutes min',
              style: TextStyle(
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected
                    ? CoachDashboardTheme.primary
                    : (isDark ? Colors.white70 : CoachDashboardTheme.textPrimary),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _availabilityPreviewCard(bool isDark) {
    const points = [
      'Clients can only book on your selected working days.',
      'Each day uses the start and end times you set above.',
      'Booked time slots automatically become unavailable.',
      'You can update your availability anytime after registration.',
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CoachDashboardTheme.primary.withValues(alpha: isDark ? 0.10 : 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CoachDashboardTheme.primary.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.event_available_rounded, size: 20, color: CoachDashboardTheme.primary),
              const SizedBox(width: 8),
              Text(
                'Appointment Availability',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Divider(height: 1, color: CoachDashboardTheme.primary.withValues(alpha: 0.2)),
          const SizedBox(height: 12),
          if (_orderedAppointmentDays.isEmpty)
            Text(
              'No appointment days selected yet.',
              style: TextStyle(fontSize: 13, color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary),
            )
          else
            ..._orderedAppointmentDays.map((day) {
              final hours = _dayAvailability[day];
              if (hours == null) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_rounded, size: 16, color: CoachDashboardTheme.success),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '$day: ${_formatTime(hours.start)} – ${_formatTime(hours.end)}',
                        style: _appointmentValueStyle(isDark),
                      ),
                    ),
                  ],
                ),
              );
            }),
          const SizedBox(height: 8),
          _appointmentInfoBlock(
            isDark: isDark,
            icon: Icons.timer_outlined,
            label: 'Duration',
            child: Text('$_appointmentDuration Minutes', style: _appointmentValueStyle(isDark)),
          ),
          const SizedBox(height: 14),
          Divider(height: 1, color: CoachDashboardTheme.primary.withValues(alpha: 0.2)),
          const SizedBox(height: 12),
          ...points.map(
            (point) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(Icons.check_circle_rounded, size: 16, color: CoachDashboardTheme.primary),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      point,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: isDark ? Colors.white70 : CoachDashboardTheme.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  TextStyle _appointmentValueStyle(bool isDark) => TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: isDark ? Colors.white : CoachDashboardTheme.textPrimary,
      );

  Widget _appointmentInfoBlock({
    required bool isDark,
    required IconData icon,
    required String label,
    required Widget child,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: CoachDashboardTheme.primary),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: isDark ? Colors.white38 : CoachDashboardTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 4),
              child,
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildAboutStep(bool isDark) {
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Tell us about yourself', style: CoachDashboardTheme.sectionTitle(isDark)),
          const SizedBox(height: 8),
          Text(
            'Share as little or as much as you like — short bios and detailed profiles are both fine. '
            'Once approved, this information can be visible to app members.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _bioController,
            readOnly: !_canEdit,
            maxLines: null,
            minLines: 3,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: _fieldDecoration(
              'Professional Bio',
              hint: 'Optional — introduce yourself in a few words or a longer story',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _experienceController,
            readOnly: !_canEdit,
            maxLines: null,
            minLines: 3,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: _fieldDecoration(
              'Work Experience',
              hint: 'Optional — coaching history, certifications highlights, achievements',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _messageController,
            readOnly: !_canEdit,
            maxLines: null,
            minLines: 2,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: _fieldDecoration(
              'Why do you want to coach?',
              hint: 'Optional — your motivation for joining VitalFitness',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReviewStep(bool isDark) {
    return _stepScroll(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _isViewOnly ? 'Submitted registration' : 'Review your application',
            style: CoachDashboardTheme.sectionTitle(isDark),
          ),
          const SizedBox(height: 8),
          Text(
            _isViewOnly
                ? 'These are the details currently on file for your coach application.'
                : 'Confirm everything is correct before submitting for admin approval.',
            style: TextStyle(color: isDark ? Colors.white60 : CoachDashboardTheme.textSecondary),
          ),
          if ((_rejectionReason ?? '').isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: CoachDashboardTheme.danger.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: CoachDashboardTheme.danger.withValues(alpha: 0.3)),
              ),
              child: Text(
                'Rejection reason: $_rejectionReason',
                style: const TextStyle(color: CoachDashboardTheme.danger, height: 1.4),
              ),
            ),
          ],
          const SizedBox(height: 20),
          _reviewCard(isDark, 'Account', [
            _reviewRow('Name', _nameController.text),
            _reviewRow('Email', _emailController.text),
          ]),
          _reviewCard(isDark, 'Personal', [
            _reviewRow('Phone', _phoneController.text),
            _reviewRow('Age', _ageController.text),
            _reviewRow('Region / Gobol', _locationController.text),
          ]),
          _reviewCard(isDark, 'Professional', [
            _reviewRow('Experience', '${_yearsExperienceController.text} years'),
            _reviewRow('Certifications', _certificationsController.text),
            _reviewRow(
              'Certificate files',
              '${_certificates.length + _existingCertificateFiles.length} uploaded',
            ),
            _reviewRow(
              'Specializations',
              _selectedSpecializations.isEmpty
                  ? _specializationController.text
                  : _selectedSpecializations.join(', '),
            ),
            _reviewRow('Working Days', _orderedWorkingDays.join(', ')),
          ]),
          _reviewCard(isDark, 'Appointment Days', [
            _reviewRow('Days', _orderedAppointmentDays.join(', ')),
            ..._orderedAppointmentDays.map((day) {
              final hours = _dayAvailability[day];
              if (hours == null) return _reviewRow(day, '—');
              return _reviewRow(day, '${_formatTime(hours.start)} – ${_formatTime(hours.end)}');
            }),
            _reviewRow('Appointment Duration', '$_appointmentDuration minutes'),
          ]),
          _reviewCard(isDark, 'Profile', [
            _reviewRow('Bio', _bioController.text),
            _reviewRow('Work History', _experienceController.text),
            _reviewRow('Motivation', _messageController.text),
          ]),
        ],
      ),
    );
  }

  Widget _reviewCard(bool isDark, String title, List<Widget> rows) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: CoachDashboardTheme.cardDecoration(isDark),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: CoachDashboardTheme.sectionLabel(isDark)),
          const SizedBox(height: 8),
          ...rows,
        ],
      ),
    );
  }

  Widget _reviewRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)),
          Text(value.isEmpty ? '—' : value, style: const TextStyle(fontSize: 14)),
        ],
      ),
    );
  }
}
