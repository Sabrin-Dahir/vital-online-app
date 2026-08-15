class Profile {
  final int? age;
  final double? heightCm;
  final double? weightKg;
  final double? bmi;
  final List<String> goals;
  final String? fitnessGoal;
  final String? gender;
  final String? activityLevel;
  final String? medicalNotes;
  final String? phone;
  final String? location;
  final String? bio;
  final String? experience;
  final List<String> specialization;
  final List<String> certifications;
  final int? yearsExperience;
  final List<String> workingDays;
  final List<String> appointmentDays;
  final String? workingHoursStart;
  final String? workingHoursEnd;
  final int? appointmentDurationMinutes;
  final List<dynamic> dayAvailability;
  final String? photoUrl;
  final String? assignedCoachName;
  final String? assignedCoachId;
  final List<Map<String, dynamic>> certificateFiles;

  Profile({
    this.age,
    this.heightCm,
    this.weightKg,
    this.bmi,
    required this.goals,
    this.fitnessGoal,
    this.gender,
    this.activityLevel,
    this.medicalNotes,
    this.phone,
    this.location,
    this.bio,
    this.experience,
    this.specialization = const [],
    this.certifications = const [],
    this.yearsExperience,
    this.workingDays = const [],
    this.appointmentDays = const [],
    this.workingHoursStart,
    this.workingHoursEnd,
    this.appointmentDurationMinutes,
    this.dayAvailability = const [],
    this.photoUrl,
    this.assignedCoachName,
    this.assignedCoachId,
    this.certificateFiles = const [],
  });

  static String _goalLabel(String? fitnessGoal) {
    switch (fitnessGoal) {
      case 'lose_weight':
        return 'Weight Loss';
      case 'gain_muscle':
        return 'Muscle Building';
      case 'maintain':
      case 'other':
        return 'General Fitness';
      default:
        return fitnessGoal?.trim() ?? '';
    }
  }

  static String? _fitnessGoalFromLabel(String? label) {
    final value = (label ?? '').trim();
    if (value.isEmpty) return null;
    // Prefer canonical specialization labels; keep legacy reverse mapping.
    final lower = value.toLowerCase();
    if (lower == 'lose_weight' || lower.contains('weight loss')) return 'Weight Loss';
    if (lower == 'gain_muscle' || lower.contains('muscle')) return 'Muscle Building';
    if (lower.contains('maintain') || lower == 'other') return 'General Fitness';
    return value;
  }

  factory Profile.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return Profile(goals: []);
    }

    final goalsRaw = json['goals'];
    final specializationRaw = json['specialization'] ?? json['specialties'];
    final certificationsRaw = json['certifications'];
    final workingDaysRaw = json['workingDays'];
    final appointmentDaysRaw = json['appointmentDays'];
    final fitnessGoal = json['fitness_goal']?.toString() ?? json['fitnessGoal']?.toString();

    List<String> goals = [];
    if (goalsRaw is List) {
      goals = goalsRaw.map((e) => e.toString()).where((e) => e.isNotEmpty).toList();
    }
    if (goals.isEmpty && fitnessGoal != null && fitnessGoal.isNotEmpty) {
      final label = _goalLabel(fitnessGoal);
      if (label.isNotEmpty) goals = [label];
    }

    List<String> asStringList(dynamic value) {
      if (value is List) {
        return value.map((e) => e.toString()).where((e) => e.trim().isNotEmpty).toList();
      }
      if (value is String && value.trim().isNotEmpty) {
        return value.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
      }
      return [];
    }

    final height = json['heightCm'] ?? json['height'];
    final weight = json['weightKg'] ?? json['weight'];
    final years = json['yearsExperience'] ?? json['years_experience'];

    return Profile(
      age: (json['age'] as num?)?.toInt(),
      heightCm: (height as num?)?.toDouble(),
      weightKg: (weight as num?)?.toDouble(),
      bmi: (json['bmi'] as num?)?.toDouble(),
      goals: goals,
      fitnessGoal: fitnessGoal,
      gender: json['gender']?.toString(),
      activityLevel: json['activity_level']?.toString() ?? json['activityLevel']?.toString(),
      medicalNotes: json['medical_notes']?.toString() ?? json['medicalNotes']?.toString(),
      phone: json['phone']?.toString(),
      location: json['location']?.toString(),
      bio: json['bio']?.toString(),
      experience: json['experience']?.toString(),
      specialization: asStringList(specializationRaw),
      certifications: asStringList(certificationsRaw),
      yearsExperience: (years as num?)?.toInt(),
      workingDays: asStringList(workingDaysRaw),
      appointmentDays: asStringList(appointmentDaysRaw),
      workingHoursStart: json['workingHoursStart']?.toString(),
      workingHoursEnd: json['workingHoursEnd']?.toString(),
      appointmentDurationMinutes: (json['appointmentDurationMinutes'] as num?)?.toInt(),
      dayAvailability: json['dayAvailability'] is List
          ? List<dynamic>.from(json['dayAvailability'] as List)
          : const [],
      photoUrl: json['photoUrl']?.toString() ?? json['avatar']?.toString(),
      assignedCoachName: json['assignedCoachName']?.toString(),
      assignedCoachId: json['assignedCoachId']?.toString(),
      certificateFiles: (json['certificateFiles'] is List)
          ? (json['certificateFiles'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .where((e) => (e['url']?.toString() ?? '').trim().isNotEmpty)
              .toList()
          : const [],
    );
  }

  factory Profile.fromUserPayload(Map<String, dynamic> json) {
    final client = json['clientData'] is Map
        ? Map<String, dynamic>.from(json['clientData'] as Map)
        : <String, dynamic>{};
    final coach = json['coachData'] is Map
        ? Map<String, dynamic>.from(json['coachData'] as Map)
        : <String, dynamic>{};
    final availability = coach['availability'] is Map
        ? Map<String, dynamic>.from(coach['availability'] as Map)
        : <String, dynamic>{};

    String? coachName;
    String? coachId;
    final assigned = client['assigned_coach'] ?? client['assigned_coach_id'];
    if (assigned is Map) {
      coachName = (assigned['full_name'] ?? assigned['name'] ?? assigned['username'])?.toString();
      coachId = (assigned['id'] ?? assigned['_id'])?.toString();
    } else if (assigned != null) {
      coachId = assigned.toString();
    }

    final nested = json['profile'] is Map
        ? Map<String, dynamic>.from(json['profile'] as Map)
        : <String, dynamic>{};

    return Profile.fromJson({
      'age': nested['age'] ?? coach['age'] ?? client['age'],
      'height': nested['heightCm'] ?? nested['height'] ?? client['height'],
      'weight': nested['weightKg'] ?? nested['weight'] ?? client['weight'],
      'gender': nested['gender'] ?? client['gender'],
      'fitness_goal': nested['fitness_goal'] ?? nested['fitnessGoal'] ?? client['fitness_goal'],
      'goals': nested['goals'],
      'activity_level': nested['activity_level'] ?? nested['activityLevel'] ?? client['activity_level'],
      'medical_notes': nested['medical_notes'] ?? nested['medicalNotes'] ?? client['medical_notes'],
      'phone': nested['phone'] ?? json['phone'] ?? coach['phone'],
      'location': nested['location'] ?? coach['location'],
      'bio': nested['bio'] ?? coach['bio'],
      'experience': nested['experience'] ?? coach['experience'],
      'specialties': nested['specialization'] ?? nested['specialties'] ?? coach['specialties'] ?? coach['specialization'],
      'certifications': nested['certifications'] ?? coach['certifications'],
      'years_experience': nested['yearsExperience'] ?? nested['years_experience'] ?? coach['years_experience'] ?? coach['yearsExperience'],
      'workingDays': nested['workingDays'] ?? availability['workingDays'] ?? coach['workingDays'],
      'appointmentDays': nested['appointmentDays'] ?? availability['appointmentDays'] ?? coach['appointmentDays'],
      'workingHoursStart': nested['workingHoursStart'] ?? availability['workingHoursStart'],
      'workingHoursEnd': nested['workingHoursEnd'] ?? availability['workingHoursEnd'],
      'appointmentDurationMinutes': nested['appointmentDurationMinutes'] ?? coach['appointmentDurationMinutes'],
      'dayAvailability': nested['dayAvailability'] ?? coach['dayAvailability'],
      'photoUrl': nested['photoUrl'] ?? json['avatar'],
      'assignedCoachName': coachName,
      'assignedCoachId': coachId,
      'certificateFiles': (nested['certificateFiles'] is List &&
              (nested['certificateFiles'] as List).isNotEmpty)
          ? nested['certificateFiles']
          : coach['certificateFiles'],
    });
  }

  Map<String, dynamic> toJson() {
    return {
      'age': age,
      'heightCm': heightCm,
      'weightKg': weightKg,
      'goals': goals,
      'fitness_goal': fitnessGoal ?? _fitnessGoalFromLabel(goals.isNotEmpty ? goals.first : null),
      'gender': gender,
      'activity_level': activityLevel,
      'medical_notes': medicalNotes,
      'phone': phone,
      'location': location,
      'bio': bio,
      'experience': experience,
      'specialization': specialization,
      'certifications': certifications,
      'yearsExperience': yearsExperience,
      'workingDays': workingDays,
      'appointmentDays': appointmentDays,
      'workingHoursStart': workingHoursStart,
      'workingHoursEnd': workingHoursEnd,
      'appointmentDurationMinutes': appointmentDurationMinutes,
      'dayAvailability': dayAvailability,
      'photoUrl': photoUrl,
      'assignedCoachName': assignedCoachName,
      'assignedCoachId': assignedCoachId,
      'certificateFiles': certificateFiles,
    };
  }

  Profile copyWith({
    int? age,
    double? heightCm,
    double? weightKg,
    double? bmi,
    List<String>? goals,
    String? fitnessGoal,
    String? gender,
    String? activityLevel,
    String? medicalNotes,
    String? phone,
    String? location,
    String? bio,
    String? experience,
    List<String>? specialization,
    List<String>? certifications,
    int? yearsExperience,
    List<String>? workingDays,
    List<String>? appointmentDays,
    String? workingHoursStart,
    String? workingHoursEnd,
    int? appointmentDurationMinutes,
    List<dynamic>? dayAvailability,
    String? photoUrl,
    String? assignedCoachName,
    String? assignedCoachId,
    List<Map<String, dynamic>>? certificateFiles,
  }) {
    return Profile(
      age: age ?? this.age,
      heightCm: heightCm ?? this.heightCm,
      weightKg: weightKg ?? this.weightKg,
      bmi: bmi ?? this.bmi,
      goals: goals ?? this.goals,
      fitnessGoal: fitnessGoal ?? this.fitnessGoal,
      gender: gender ?? this.gender,
      activityLevel: activityLevel ?? this.activityLevel,
      medicalNotes: medicalNotes ?? this.medicalNotes,
      phone: phone ?? this.phone,
      location: location ?? this.location,
      bio: bio ?? this.bio,
      experience: experience ?? this.experience,
      specialization: specialization ?? this.specialization,
      certifications: certifications ?? this.certifications,
      yearsExperience: yearsExperience ?? this.yearsExperience,
      workingDays: workingDays ?? this.workingDays,
      appointmentDays: appointmentDays ?? this.appointmentDays,
      workingHoursStart: workingHoursStart ?? this.workingHoursStart,
      workingHoursEnd: workingHoursEnd ?? this.workingHoursEnd,
      appointmentDurationMinutes:
          appointmentDurationMinutes ?? this.appointmentDurationMinutes,
      dayAvailability: dayAvailability ?? this.dayAvailability,
      photoUrl: photoUrl ?? this.photoUrl,
      assignedCoachName: assignedCoachName ?? this.assignedCoachName,
      assignedCoachId: assignedCoachId ?? this.assignedCoachId,
      certificateFiles: certificateFiles ?? this.certificateFiles,
    );
  }
}

class User {
  final String id;
  final String name;
  final String email;
  /// API role: `user` (client/member), `coach`, or `admin`.
  final String role;
  final String? phone;
  final String? status;
  final Profile? profile;
  final String? coachApplicationStatus;
  final DateTime? coachApplicationReviewedAt;
  final bool mustChangePassword;

  User({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.status,
    this.profile,
    this.coachApplicationStatus,
    this.coachApplicationReviewedAt,
    this.mustChangePassword = false,
  });

  /// Client / member account (same as web `/member/*`).
  bool get isClient => role == 'user';

  /// Approved coach account (same as web `/coach/*`).
  bool get isCoach => role == 'coach';

  bool get isAdmin => role == 'admin';

  /// Coach application is pending admin approval.
  bool get hasPendingCoachApplication =>
      coachApplicationStatus == 'pending';

  bool get hasRejectedCoachApplication =>
      coachApplicationStatus == 'rejected';

  /// Explicit approval, or legacy coach accounts with no status field set.
  bool get hasApprovedCoachApplication {
    if (coachApplicationStatus == 'approved') return true;
    if (coachApplicationStatus == 'pending' || coachApplicationStatus == 'rejected') {
      return false;
    }
    // Legacy admin-created coaches: role=coach and no application status.
    return isCoach
        && (coachApplicationStatus == null || coachApplicationStatus!.isEmpty);
  }

  /// Human-readable label for the coach application gate screens.
  String get coachApplicationStatusLabel {
    if (hasApprovedCoachApplication) return 'Approved';
    if (hasRejectedCoachApplication) return 'Rejected';
    if (hasPendingCoachApplication) return 'Pending';
    return 'Unknown';
  }

  static String? _coachApplicationStatusFromJson(Map<String, dynamic> json) {
    final direct = json['coachApplicationStatus']?.toString();
    if (direct != null && direct.isNotEmpty) return direct;
    final coachData = json['coachData'];
    if (coachData is Map) {
      final approval = coachData['approval_status']?.toString();
      if (approval != null && approval.isNotEmpty) return approval;
    }
    return null;
  }

  factory User.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return User(
        id: '',
        name: '',
        email: '',
        role: 'user',
      );
    }

    return User(
      id: (json['id'] ?? json['_id'])?.toString() ?? '',
      name: (json['full_name'] ?? json['name'] ?? json['username'] ?? '').toString(),
      email: (json['username'] ?? json['email'] ?? '').toString(),
      role: json['role']?.toString() ?? 'user',
      phone: json['phone']?.toString(),
      status: json['status']?.toString(),
      profile: Profile.fromUserPayload(json),
      coachApplicationStatus: _coachApplicationStatusFromJson(json),
      coachApplicationReviewedAt: json['coachApplicationReviewedAt'] != null
          ? DateTime.tryParse(json['coachApplicationReviewedAt'].toString())
          : null,
      mustChangePassword: json['must_change_password'] == true,
    );
  }

  User copyWith({
    String? id,
    String? name,
    String? email,
    String? role,
    String? phone,
    String? status,
    Profile? profile,
    String? coachApplicationStatus,
    DateTime? coachApplicationReviewedAt,
    bool? mustChangePassword,
  }) {
    return User(
      id: id ?? this.id,
      name: name ?? this.name,
      email: email ?? this.email,
      role: role ?? this.role,
      phone: phone ?? this.phone,
      status: status ?? this.status,
      profile: profile ?? this.profile,
      coachApplicationStatus: coachApplicationStatus ?? this.coachApplicationStatus,
      coachApplicationReviewedAt:
          coachApplicationReviewedAt ?? this.coachApplicationReviewedAt,
      mustChangePassword: mustChangePassword ?? this.mustChangePassword,
    );
  }
}
