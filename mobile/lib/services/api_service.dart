import 'dart:async';
import 'dart:convert';
import 'dart:io' show SocketException;

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../models/user_model.dart';
import '../models/activity_log_model.dart';
import '../models/progress_model.dart';
import '../utils/password_utils.dart';
import '../utils/section_data_cache.dart';

/// Thrown when the API returns HTTP 409 (e.g. active diet plan already exists).
class ApiConflictException implements Exception {
  final String message;
  final String code;
  final Map<String, dynamic>? body;

  ApiConflictException(this.message, {this.code = '', this.body});

  @override
  String toString() => message;
}

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String? _token;

  String get baseUrl => ApiConfig.baseUrl;

  /// `connected` = API + DB, `degraded` = API up but DB down, `offline` = unreachable.
  Future<String> getApiStatus() async {
    try {
      final response = await http
          .get(Uri.parse(ApiConfig.healthUrl))
          .timeout(ApiConfig.healthTimeout);
      if (response.statusCode == 503) return 'degraded';
      if (response.statusCode != 200) return 'offline';
      try {
        final body = jsonDecode(response.body);
        if (body is Map &&
            body['database'] != null &&
            body['database'].toString() != 'connected') {
          return 'degraded';
        }
      } catch (_) {
        // Non-JSON health body still means the API process responded.
      }
      return 'connected';
    } catch (_) {
      return 'offline';
    }
  }

  /// Returns true when the API server responds (even if the database is down).
  Future<bool> isBackendReachable() async {
    final status = await getApiStatus();
    return status == 'connected' || status == 'degraded';
  }

  /// User-friendly message for network / connection failures.
  static String friendlyError(Object error) {
    final message = error.toString();
    if (error is SocketException ||
        message.contains('Connection refused') ||
        message.contains('Failed host lookup') ||
        message.contains('Network is unreachable') ||
        message.contains('TimeoutException')) {
      if (ApiConfig.isLocalOverride) {
        return 'Cannot reach the server at ${ApiConfig.baseUrl}.\n\n'
            'Start the backend first:\n'
            '  cd backend && npm start';
      }
      return 'Cannot reach the server at ${ApiConfig.baseUrl}.\n\n'
          'Check your internet connection. If this persists, the '
          'production API may be waking up (Render) — wait ~30s and retry.';
    }
    return message.replaceAll('Exception: ', '');
  }

  /// Unwraps either a raw JSON list or `{ items: [...] }` / `{ data: [...] }`.
  static List<dynamic> asItemList(dynamic decoded) {
    if (decoded is List) return decoded;
    if (decoded is Map) {
      final items = decoded['items'] ?? decoded['data'] ?? decoded['results'];
      if (items is List) return items;
    }
    throw Exception('Unexpected list response from server');
  }

  /// Display name for admin user/coach payloads (supports legacy + current fields).
  static String displayName(
    Map<dynamic, dynamic>? user, {
    String fallback = 'Unknown',
  }) {
    if (user == null) return fallback;
    final fullName = (user['full_name'] ?? user['name'] ?? '')
        .toString()
        .trim();
    if (fullName.isNotEmpty) return fullName;
    final username = (user['username'] ?? user['email'] ?? '')
        .toString()
        .trim();
    if (username.isNotEmpty) return username;
    return fallback;
  }

  static String displayIdentity(Map<dynamic, dynamic>? user) {
    if (user == null) return '';
    return (user['username'] ?? user['email'] ?? user['phone'] ?? '')
        .toString();
  }

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('token');
  }

  bool get isAuthenticated => _token != null;

  String? get token => _token;

  Map<String, String> _headers() {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (_token != null) {
      headers['Authorization'] = 'Bearer $_token';
    }
    return headers;
  }


  /// Shared request timeout so loading indicators cannot hang forever.
  Future<http.Response> _send(
    Future<http.Response> future, {
    Duration? timeout,
  }) {
    return future.timeout(
      timeout ?? ApiConfig.requestTimeout,
      onTimeout: () => throw TimeoutException(
        'Request timed out. Please check your connection and try again.',
      ),
    );
  }

  Future<void> _saveToken(String token) async {
    _token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('token', token);
  }

  Future<void> clearAuth() async {
    _token = null;
    SectionDataCache.clear();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
  }

  // --- Authentication ---

  Future<User> login(String email, String password) async {
    try {
      final identity = PasswordUtils.normalizeEmail(email);
      final response = await _send(http.post(
        Uri.parse('$baseUrl/auth/login'),
        headers: _headers(),
        body: jsonEncode({
          // Backend authenticates by username; email-style usernames are supported.
          'username': identity,
          'email': identity,
          'password': password,
        }),
      ));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final token = data['token'] as String;
        await _saveToken(token);
        return User.fromJson(data['user'] as Map<String, dynamic>);
      } else {
        final errorMsg = _parseError(response);
        throw Exception(errorMsg);
      }
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  Future<User> register({
    required String fullName,
    required String username,
    required String password,
    String? phone,
    String? gender,
    int? age,
    double? heightCm,
    double? weightKg,
    String? fitnessGoal,
  }) async {
    try {
      final response = await _send(http.post(
        Uri.parse('$baseUrl/auth/register'),
        headers: _headers(),
        body: jsonEncode({
          // Exact registration fields from the form — do not invent defaults.
          'full_name': fullName.trim(),
          'username': username.trim().toLowerCase(),
          'password': password,
          'phone': (phone ?? '').trim(),
          if (gender != null && gender.trim().isNotEmpty)
            'gender': gender.trim(),
          if (age != null) 'age': age,
          if (heightCm != null) 'height': heightCm,
          if (weightKg != null) 'weight': weightKg,
          if (fitnessGoal != null && fitnessGoal.trim().isNotEmpty)
            'fitness_goal': fitnessGoal.trim(),
        }),
      ));

      if (response.statusCode == 201) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final token = data['token'] as String?;
        final userJson = data['user'] as Map<String, dynamic>?;
        if (token == null || userJson == null) {
          throw Exception(
            'Registration succeeded but session could not be started. Please sign in.',
          );
        }
        await _saveToken(token);
        return User.fromJson(userJson);
      } else {
        final errorMsg = _parseError(response);
        throw Exception(errorMsg);
      }
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  /// Requests a password reset code be emailed to the address.
  /// Returns the generic server message.
  Future<String> forgotPassword(String email) async {
    try {
      final response = await _send(http.post(
        Uri.parse('$baseUrl/auth/forgot-password'),
        headers: _headers(),
        body: jsonEncode({'email': PasswordUtils.normalizeEmail(email)}),
      ));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['message']?.toString() ??
            'If an account exists for that email, a reset code has been sent.';
      }
      throw Exception(_parseError(response));
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  /// Resets the password using the emailed code.
  Future<String> resetPassword({
    required String email,
    required String code,
    required String newPassword,
  }) async {
    try {
      final response = await _send(http.post(
        Uri.parse('$baseUrl/auth/reset-password'),
        headers: _headers(),
        body: jsonEncode({
          'email': PasswordUtils.normalizeEmail(email),
          'code': code.trim(),
          'newPassword': newPassword,
        }),
      ));
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['message']?.toString() ?? 'Password has been reset.';
      }
      throw Exception(_parseError(response));
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  Future<User?> getMe() async {
    if (_token == null) return null;

    try {
      final response = await _send(http.get(
        Uri.parse('$baseUrl/auth/me'),
        headers: _headers(),
      ));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        final userJson = data is Map ? data['user'] : null;
        if (userJson is Map) {
          return User.fromJson(Map<String, dynamic>.from(userJson));
        }
        return null;
      } else {
        // Token might be invalid/expired, so clear it
        await clearAuth();
        return null;
      }
    } catch (e) {
      // Network error, keep token but return null for now to be safe
      return null;
    }
  }

  // --- Profile Updates ---

  Future<Profile> updateProfile({
    String? fullName,
    int? age,
    double? heightCm,
    double? weightKg,
    List<String>? goals,
    String? gender,
    String? activityLevel,
    String? medicalNotes,
    String? phone,
    String? fitnessGoal,
    String? bio,
    String? experience,
    String? location,
    List<String>? specialization,
    int? yearsExperience,
    List<String>? certifications,
  }) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/user/profile'),
      headers: _headers(),
      body: jsonEncode({
        if (fullName != null) 'full_name': fullName.trim(),
        if (age != null) 'age': age,
        if (heightCm != null) 'heightCm': heightCm,
        if (weightKg != null) 'weightKg': weightKg,
        if (goals != null) 'goals': goals,
        if (gender != null) 'gender': gender,
        if (activityLevel != null) 'activity_level': activityLevel,
        if (medicalNotes != null) 'medical_notes': medicalNotes,
        if (phone != null) 'phone': phone,
        if (fitnessGoal != null) 'fitness_goal': fitnessGoal,
        if (bio != null) 'bio': bio,
        if (experience != null) 'experience': experience,
        if (location != null) 'location': location,
        if (specialization != null) 'specialization': specialization,
        if (yearsExperience != null) 'yearsExperience': yearsExperience,
        if (certifications != null) 'certifications': certifications,
      }),
    ));

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (data['user'] is Map) {
        return Profile.fromUserPayload(
          Map<String, dynamic>.from(data['user'] as Map),
        );
      }
      return Profile.fromJson(data['profile'] as Map<String, dynamic>?);
    } else {
      final errorMsg = _parseError(response);
      throw Exception(errorMsg);
    }
  }

  /// Uploads (or clears) the profile photo. [dataUrl] should be a
  /// base64 image data URL, or an empty string to remove the photo.
  Future<Profile> updateProfilePhoto(String dataUrl) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/user/profile/photo'),
      headers: _headers(),
      body: jsonEncode({'photo': dataUrl}),
    ));
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return Profile.fromJson(data['profile'] as Map<String, dynamic>);
    }
    throw Exception(_parseError(response));
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/auth/change-password'),
      headers: _headers(),
      body: jsonEncode({
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      }),
    ));

    if (response.statusCode != 200) {
      throw Exception(_parseError(response));
    }
  }

  // --- Daily Progress ---

  Future<ProgressData> getProgress() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/progress'),
      headers: _headers(),
    ));

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      return ProgressData.fromJson(data as Map<String, dynamic>);
    } else {
      final errorMsg = _parseError(response);
      throw Exception(errorMsg);
    }
  }

  /// Existing user dashboard aggregate (assignments, dailyTrackings, etc.).
  Future<Map<String, dynamic>?> getUserDashboard() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/dashboard/user'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic>) return body;
      if (body is Map) return Map<String, dynamic>.from(body);
      return null;
    }
    if (response.statusCode == 404) return null;
    throw Exception(_parseError(response));
  }

  /// Existing coach dashboard aggregate (assigned clients, dailyTrackings, workout logs).
  Future<Map<String, dynamic>?> getCoachDashboard() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/dashboard/coach'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic>) return body;
      if (body is Map) return Map<String, dynamic>.from(body);
      return null;
    }
    if (response.statusCode == 404) return null;
    throw Exception(_parseError(response));
  }

  // --- Log Workouts ---

  Future<ActivityLog> logActivity({
    required String activityType,
    required int durationMinutes,
    required double caloriesBurned,
    List<WorkoutSet>? sets,
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/activity/log'),
      headers: _headers(),
      body: jsonEncode({
        'activityType': activityType,
        'durationMinutes': durationMinutes,
        'caloriesBurned': caloriesBurned,
        if (sets != null) 'sets': sets.map((s) => s.toJson()).toList(),
      }),
    ));

    if (response.statusCode == 201) {
      final data = jsonDecode(response.body);
      return ActivityLog.fromJson(data as Map<String, dynamic>);
    } else {
      final errorMsg = _parseError(response);
      throw Exception(errorMsg);
    }
  }

  // --- Log Hydration ---

  Future<bool> logWater(double amountMl) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/water/log'),
      headers: _headers(),
      body: jsonEncode({'amountMl': amountMl.toInt()}),
    ));

    if (response.statusCode == 201 || response.statusCode == 200) return true;
    throw Exception(_parseError(response));
  }

  // --- Log Nutrition ---

  Future<bool> logMeal({
    required String mealName,
    required double calories,
    double protein = 0,
    double carbs = 0,
    double fats = 0,
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/diet/log'),
      headers: _headers(),
      body: jsonEncode({
        'mealName': mealName,
        'calories': calories.toInt(),
        'protein': protein.toInt(),
        'carbs': carbs.toInt(),
        'fats': fats.toInt(),
      }),
    ));

    if (response.statusCode == 201 || response.statusCode == 200) return true;
    throw Exception(_parseError(response));
  }

  // --- Coach Endpoints ---

  Future<List<dynamic>> getCoaches() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/trainers'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List<dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  Future<Map<String, dynamic>> getPublicCoach(String id) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/trainers/$id'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  /// Returns `{ reviews: [...], myReview: {...}|null, averageRating, numReviews }`.
  Future<Map<String, dynamic>> getCoachReviews(String coachId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/trainers/$coachId/reviews'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> submitCoachReview({
    required String coachId,
    required int rating,
    String comment = '',
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/trainers/$coachId/reviews'),
      headers: _headers(),
      body: jsonEncode({'rating': rating, 'comment': comment}),
    ));
    if (response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<void> deleteCoachReview(String coachId) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/user/trainers/$coachId/reviews'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) {
      throw Exception(_parseError(response));
    }
  }

  /// Upload certificate to ImageKit, then OCR-check the uploaded file for the applicant name.
  /// Returns `{ url, fileName, mimeType, uploadedAt, matchedName }`.
  Future<Map<String, dynamic>> validateCoachCertificate({
    required String dataUrl,
    required String expectedName,
    String? fileName,
  }) async {
    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/auth/validate-coach-certificate'),
            headers: _headers(),
            body: jsonEncode({
              'dataUrl': dataUrl,
              'expectedName': expectedName.trim(),
              if (fileName != null && fileName.trim().isNotEmpty) 'fileName': fileName.trim(),
            }),
          )
          .timeout(const Duration(seconds: 120));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is Map && data['ok'] == true) {
          return Map<String, dynamic>.from(data);
        }
      }
      throw Exception(_parseError(response));
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  Future<User> registerCoach({
    required String name,
    required String email,
    required String password,
    required String phone,
    required int age,
    required String location,
    required int yearsExperience,
    required String certifications,
    required dynamic specialization,
    required String bio,
    required String experience,
    required String message,
    required List<String> workingDays,
    required List<String> appointmentDays,
    required List<Map<String, String>> dayAvailability,
    int appointmentDurationMinutes = 60,
    List<Map<String, dynamic>> certificateFiles = const [],
  }) async {
    try {
      final response = await _send(http.post(
        Uri.parse('$baseUrl/auth/register-coach'),
        headers: _headers(),
        body: jsonEncode({
          'name': name.trim(),
          'email': PasswordUtils.normalizeEmail(email),
          'username': PasswordUtils.normalizeEmail(email),
          'password': password,
          'phone': phone,
          'age': age,
          'location': location,
          'yearsExperience': yearsExperience,
          'certifications': certifications,
          'specialization': specialization,
          'bio': bio,
          'experience': experience,
          'message': message,
          'workingDays': workingDays,
          'appointmentDays': appointmentDays,
          'dayAvailability': dayAvailability,
          'appointmentDurationMinutes': appointmentDurationMinutes,
          'certificateFiles': certificateFiles,
        }),
      ));

      if (response.statusCode == 201) {
        final data = jsonDecode(response.body);
        final token = data['token'] as String;
        await _saveToken(token);
        return User.fromJson(data['user'] as Map<String, dynamic>);
      } else {
        throw Exception(_parseError(response));
      }
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  // --- Admin Endpoints ---

  Future<List<dynamic>> getUsers({String? role, String? query}) async {
    final params = <String, String>{'role': 'user'};
    if (query != null && query.isNotEmpty) params['q'] = query;
    final uri = Uri.parse(
      '$baseUrl/admin/users',
    ).replace(queryParameters: params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return asItemList(jsonDecode(response.body))
          .where((u) => u is Map && (u['role'] as String? ?? '') == 'user')
          .toList();
    } else {
      throw Exception(_parseError(response));
    }
  }

  Future<Map<String, dynamic>> getAdminUserDetail(String userId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/users/$userId/detail'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getAdminTrainers() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/trainers'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return asItemList(jsonDecode(response.body))
          .where((c) => c is Map && (c['role'] as String? ?? '') == 'coach')
          .toList();
    }
    throw Exception(_parseError(response));
  }

  /// Assigned clients for the logged-in coach.
  ///
  /// When [light] is true, asks the API to skip heavy per-client snapshots
  /// (workout forms / pickers). Full mode keeps dashboard analysis fields.
  Future<List<dynamic>> getCoachClients({bool light = false}) async {
    final uri = Uri.parse('$baseUrl/coach/clients').replace(
      queryParameters: light ? const {'light': '1'} : null,
    );
    final response = await _send(http.get(uri, headers: _headers()));

    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List<dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  Future<List<dynamic>> getCoachSchedules() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/schedules'),
      headers: _headers(),
    ));

    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List<dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  Future<List<dynamic>> getSessions() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/session'),
      headers: _headers(),
    ));

    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List<dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  // --- New Coach/Dashboard Methods ---

  Future<Map<String, dynamic>> createSession(Map<String, dynamic> data) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/session'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateSessionStatus(
    String sessionId,
    String status,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$sessionId/status'),
      headers: _headers(),
      body: jsonEncode({'status': status}),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> confirmSession(
    String id, {
    String? coachNotes,
    String? sessionMode,
    String? meetingLink,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/confirm'),
      headers: _headers(),
      body: jsonEncode({
        if (coachNotes != null) 'coachNotes': coachNotes,
        if (sessionMode != null) 'sessionMode': sessionMode,
        if (meetingLink != null) 'meetingLink': meetingLink,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rescheduleSession(
    String id,
    String date, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/reschedule'),
      headers: _headers(),
      body: jsonEncode({
        'date': date,
        if (coachNotes != null) 'coachNotes': coachNotes,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> startSession(
    String id, {
    String? meetingLink,
    String? sessionMode,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/start'),
      headers: _headers(),
      body: jsonEncode({
        if (meetingLink != null) 'meetingLink': meetingLink,
        if (sessionMode != null) 'sessionMode': sessionMode,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateSessionMeetingLink(
    String id, {
    String? meetingLink,
    String? sessionMode,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/meeting-link'),
      headers: _headers(),
      body: jsonEncode({
        if (meetingLink != null) 'meetingLink': meetingLink,
        if (sessionMode != null) 'sessionMode': sessionMode,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> completeSession(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/complete'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> cancelSession(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/cancel'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateSessionNotes(
    String id, {
    String? coachNotes,
    String? notes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id/notes'),
      headers: _headers(),
      body: jsonEncode({
        if (coachNotes != null) 'coachNotes': coachNotes,
        if (notes != null) 'notes': notes,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateSession(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/session/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> deleteSession(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/session/$id'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> addSessionAttachment(
    String id, {
    required String file,
    String name = 'Attachment',
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/session/$id/attachments'),
      headers: _headers(),
      body: jsonEncode({'file': file, 'name': name}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createFollowUpSession(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/session/$id/follow-up'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  // --- Appointments ---

  Future<List<dynamic>> getCoachAppointments() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/appointments'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createCoachAppointment(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/appointments'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201) {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic>) return body;
      return Map<String, dynamic>.from(body as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> approveAppointment(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/approve'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rejectAppointment(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/reject'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rescheduleAppointment(
    String id,
    String dateTime, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/reschedule'),
      headers: _headers(),
      body: jsonEncode({
        'dateTime': dateTime,
        if (coachNotes != null) 'coachNotes': coachNotes,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> completeAppointment(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/complete'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateAppointmentNotes(
    String id,
    String coachNotes,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/notes'),
      headers: _headers(),
      body: jsonEncode({'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getUserAppointments() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/appointments'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> requestAppointment(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/appointments/request'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  // Returns { date, dayName, isWorkingDay, workingDays, slots: [{time, available, booked, past}] }
  Future<Map<String, dynamic>> getCoachAvailability(
    String coachId,
    String date,
  ) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/appointments/availability').replace(
        queryParameters: {
          'coachId': coachId,
          'date': date,
          'timezoneOffsetMinutes': '${DateTime.now().timeZoneOffset.inMinutes}',
        },
      ),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> bookAppointment({
    required String coachId,
    required String date,
    required String time,
    String notes = '',
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/appointments/book'),
      headers: _headers(),
      body: jsonEncode({
        'coachId': coachId,
        'date': date,
        'time': time,
        'notes': notes,
        'timezoneOffsetMinutes': DateTime.now().timeZoneOffset.inMinutes,
      }),
    ));
    if (response.statusCode == 201)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> cancelUserAppointment(String id) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/user/appointments/$id/cancel'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> coachCancelAppointment(
    String id, {
    String? coachNotes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/cancel'),
      headers: _headers(),
      body: jsonEncode({if (coachNotes != null) 'coachNotes': coachNotes}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> startAppointment(
    String id, {
    String? meetingLink,
    String? sessionMode,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/start'),
      headers: _headers(),
      body: jsonEncode({
        if (meetingLink != null) 'meetingLink': meetingLink,
        if (sessionMode != null) 'sessionMode': sessionMode,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateAppointmentMeetingLink(
    String id, {
    String? meetingLink,
    String? sessionMode,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/appointments/$id/meeting-link'),
      headers: _headers(),
      body: jsonEncode({
        if (meetingLink != null) 'meetingLink': meetingLink,
        if (sessionMode != null) 'sessionMode': sessionMode,
      }),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> addAppointmentAttachment(
    String id, {
    required String file,
    String name = 'Attachment',
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/appointments/$id/attachments'),
      headers: _headers(),
      body: jsonEncode({'file': file, 'name': name}),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createFollowUpAppointment(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/appointments/$id/follow-up'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createExercisePlan(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/exercise-plans'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createDietPlan(Map<String, dynamic> data) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/diet-plans'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200 || response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    Map<String, dynamic>? body;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode == 409) {
      throw ApiConflictException(
        body?['message']?.toString() ??
            'An active diet plan already exists for this assignee.',
        code: body?['code']?.toString() ?? 'ACTIVE_PLAN_EXISTS',
        body: body,
      );
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachDietPlans({
    String? search,
    String? status,
    String? assigneeType,
    String sort = 'newest',
    int page = 1,
    int limit = 10,
  }) async {
    final params = <String, String>{
      'page': '$page',
      'limit': '$limit',
      'sort': sort,
    };
    if (search != null && search.isNotEmpty) params['search'] = search;
    if (status != null && status.isNotEmpty && status != 'all')
      params['status'] = status;
    if (assigneeType != null &&
        assigneeType.isNotEmpty &&
        assigneeType != 'all') {
      params['assigneeType'] = assigneeType;
    }

    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/diet-plans').replace(queryParameters: params),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is List) {
        return {
          'plans': body,
          'total': body.length,
          'page': page,
          'totalPages': 1,
        };
      }
      return Map<String, dynamic>.from(body as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getDietPlanCompletions({
    String status = 'all',
  }) async {
    final params = <String, String>{};
    if (status.isNotEmpty && status != 'all') params['status'] = status;
    final response = await _send(http.get(
      Uri.parse(
        '$baseUrl/coach/diet-plans/completions',
      ).replace(queryParameters: params.isEmpty ? null : params),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getDietPlanById(String planId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/diet-plans/$planId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<void> archiveDietPlan(String planId) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/diet-plans/$planId'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendDietPlanAgain(String planId) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/diet-plans/$planId/send'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getCoachDietPlansLegacy() async {
    final data = await getCoachDietPlans(limit: 100);
    return (data['plans'] as List<dynamic>? ?? []);
  }

  Future<Map<String, dynamic>?> getGroupDietPlan(String classId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/diet-plans/groups/$classId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body == null) return null;
      return Map<String, dynamic>.from(body as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getGroupDietProgress(
    String classId, {
    int days = 14,
  }) async {
    final response = await _send(http.get(
      Uri.parse(
        '$baseUrl/coach/diet-plans/groups/$classId/progress?days=$days',
      ),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendGroupMealReminders(String classId) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/diet-plans/groups/$classId/reminders'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>?> getClientDietPlan(String clientId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/diet-plans/client/$clientId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body == null) return null;
      return Map<String, dynamic>.from(body as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateDietPlan(
    String planId,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/diet-plans/$planId'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getClientDietProgress(
    String clientId, {
    int days = 14,
    String? planId,
  }) async {
    final params = <String, String>{'days': '$days'};
    if (planId != null && planId.isNotEmpty) params['planId'] = planId;
    final response = await _send(http.get(
      Uri.parse(
        '$baseUrl/coach/diet-plans/client/$clientId/progress',
      ).replace(queryParameters: params),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> markClientAdherence(
    String clientId,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/diet-plans/client/$clientId/adherence'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendMealReminders(String clientId) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/diet-plans/client/$clientId/reminders'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>?> getDietPlan() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/diet/plan'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic>) return body;
      if (body is Map) return Map<String, dynamic>.from(body);
      return <String, dynamic>{};
    }
    // No assigned plan yet — treat as empty, not a hard error.
    if (response.statusCode == 404) return null;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getUserDietPlanHistory() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/diet/plan-history'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is Map) return List<dynamic>.from(body['plans'] as List? ?? []);
      if (body is List) return body;
      return [];
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getDietHistory() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/diet/history'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getUserDietProgress({int days = 14}) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/diet/progress?days=$days'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> logDietAdherence(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/diet/adherence'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createSchedule(Map<String, dynamic> data) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/schedules'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getExerciseLibrary() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/exercises'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getExercisePlans(String clientId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/exercise-plans/client/$clientId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getGroupExercisePlans(String classId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/exercise-plans/groups/$classId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateExercisePlan(
    String planId,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/exercise-plans/$planId'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteExercisePlan(String planId) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/exercise-plans/$planId'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getClientWorkoutProgress(
    String clientId, {
    int days = 30,
  }) async {
    final response = await _send(http.get(
      Uri.parse(
        '$baseUrl/coach/exercise-plans/client/$clientId/progress?days=$days',
      ),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getGroupWorkoutProgress(String classId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/exercise-plans/groups/$classId/progress'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> sendWorkoutReminder(String planId) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/exercise-plans/$planId/reminder'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getUserExercisePlans() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/workouts'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> completeWorkout(
    String planId, {
    required String notes,
    required int durationMinutes,
    required String proofPhoto,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/user/workouts/$planId/complete'),
      headers: _headers(),
      body: jsonEncode({
        'notes': notes,
        'durationMinutes': durationMinutes,
        'proofPhoto': proofPhoto,
      }),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getUserWorkoutProgress({int days = 30}) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/workouts/progress?days=$days'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getWorkoutTemplates() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/workout-templates'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<String>> getWorkoutPresets() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/workout-presets'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body is Map && body['presets'] is List) {
        return (body['presets'] as List).map((e) => e.toString()).toList();
      }
      if (body is List) return body.map((e) => e.toString()).toList();
    }
    return const [
      'Yoga',
      'Cardio',
      'Strength Training',
      'HIIT',
      'Core',
      'Flexibility',
      'Full Body',
    ];
  }

  Future<Map<String, dynamic>> createWorkoutTemplate(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/workout-templates'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateWorkoutTemplate(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/workout-templates/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteWorkoutTemplate(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/workout-templates/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachWorkoutSchedules({
    String? clientId,
    String? classId,
  }) async {
    final params = <String, String>{};
    if (clientId != null) params['clientId'] = clientId;
    if (classId != null) params['classId'] = classId;
    final uri = Uri.parse(
      '$baseUrl/coach/workout-schedules',
    ).replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createWorkoutSchedule(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/workout-schedules'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateWorkoutSchedule(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/workout-schedules/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteWorkoutSchedule(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/workout-schedules/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getUserWorkoutSchedules({
    bool bustCache = false,
  }) async {
    final params = <String, String>{
      'timezoneOffsetMinutes': DateTime.now().timeZoneOffset.inMinutes
          .toString(),
    };
    if (bustCache) {
      params['_'] = DateTime.now().millisecondsSinceEpoch.toString();
    }
    final uri = Uri.parse(
      '$baseUrl/user/workout-schedules',
    ).replace(queryParameters: params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getCoachWeeklyWorkoutPlans({
    String? clientId,
    String? classId,
  }) async {
    final params = <String, String>{};
    if (clientId != null) params['clientId'] = clientId;
    if (classId != null) params['classId'] = classId;
    final uri = Uri.parse(
      '$baseUrl/coach/weekly-workout-plans',
    ).replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createWeeklyWorkoutPlan(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/weekly-workout-plans'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateWeeklyWorkoutPlan(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/weekly-workout-plans/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteWeeklyWorkoutPlan(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/weekly-workout-plans/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getUserWeeklySchedule({
    DateTime? weekStart,
    bool bustCache = false,
  }) async {
    final params = <String, String>{
      'timezoneOffsetMinutes': DateTime.now().timeZoneOffset.inMinutes
          .toString(),
    };
    if (weekStart != null) {
      params['weekStart'] =
          '${weekStart.year}-${weekStart.month.toString().padLeft(2, '0')}-${weekStart.day.toString().padLeft(2, '0')}';
    }
    if (bustCache) {
      params['_'] = DateTime.now().millisecondsSinceEpoch.toString();
    }
    final uri = Uri.parse(
      '$baseUrl/user/workout-schedules/weekly',
    ).replace(queryParameters: params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> completeWorkoutSchedule(
    String scheduleId, {
    required String notes,
    required int durationMinutes,
    required String proofPhoto,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/user/workout-schedules/$scheduleId/complete'),
      headers: _headers(),
      body: jsonEncode({
        'notes': notes,
        'durationMinutes': durationMinutes,
        'proofPhoto': proofPhoto,
      }),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getPendingWorkoutSubmissions() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/workout-submissions/pending'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> reviewWorkoutSubmission({
    required String id,
    required String source,
    required String status,
    String feedback = '',
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/workout-submissions/$id/review'),
      headers: _headers(),
      body: jsonEncode({
        'source': source,
        'status': status,
        'feedback': feedback,
      }),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getPendingActivities() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/activities/pending'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateActivityStatus(
    String activityId,
    String status,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/activities/$activityId/status'),
      headers: _headers(),
      body: jsonEncode({'status': status}),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getCoachClasses({bool light = false}) async {
    final uri = light
        ? Uri.parse('$baseUrl/coach/classes').replace(queryParameters: const {'light': '1'})
        : Uri.parse('$baseUrl/coach/classes');
    final response = await _send(http.get(
      uri,
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachClass(String id) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/classes/$id'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createCoachClass(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/classes'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200 || response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateCoachClass(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/coach/classes/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteCoachClass(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/classes/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> enrollInCoachClass(
    String classId,
    String studentId,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/classes/$classId/enroll'),
      headers: _headers(),
      body: jsonEncode({'studentId': studentId}),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> unenrollFromCoachClass(
    String classId,
    String userId,
  ) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/coach/classes/$classId/enroll/$userId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  /// Move a client to another group, or remove them when [classId] is null.
  Future<Map<String, dynamic>> changeClientGroup(
    String clientId, {
    String? classId,
    String? fromClassId,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/clients/$clientId/group'),
      headers: _headers(),
      body: jsonEncode({
        'classId': classId,
        if (fromClassId != null) 'fromClassId': fromClassId,
      }),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachClientDetail(String clientId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/clients/$clientId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> markClassAttendance(
    String classId,
    String studentId,
    bool present,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/classes/$classId/attendance'),
      headers: _headers(),
      body: jsonEncode({'studentId': studentId, 'present': present}),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachAttendance({
    String? range,
    String? type,
    String? status,
    String? clientId,
    String? groupId,
  }) async {
    final params = <String, String>{};
    if (range != null && range.isNotEmpty) params['range'] = range;
    if (type != null && type.isNotEmpty) params['type'] = type;
    if (status != null && status.isNotEmpty) params['status'] = status;
    if (clientId != null && clientId.isNotEmpty) params['clientId'] = clientId;
    if (groupId != null && groupId.isNotEmpty) params['groupId'] = groupId;
    final uri = Uri.parse('$baseUrl/coach/attendance').replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachAttendanceSummary() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/attendance/summary'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getAttendanceByClients({String? range, String? type}) async {
    final params = <String, String>{};
    if (range != null && range.isNotEmpty) params['range'] = range;
    if (type != null && type.isNotEmpty) params['type'] = type;
    final uri = Uri.parse('$baseUrl/coach/attendance/clients')
        .replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getAttendanceByGroups({String? range}) async {
    final params = <String, String>{};
    if (range != null && range.isNotEmpty) params['range'] = range;
    final uri = Uri.parse('$baseUrl/coach/attendance/groups')
        .replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getClientAttendanceDetail(
    String clientId, {
    String? range,
    String? type,
  }) async {
    final params = <String, String>{};
    if (range != null && range.isNotEmpty) params['range'] = range;
    if (type != null && type.isNotEmpty) params['type'] = type;
    final uri = Uri.parse('$baseUrl/coach/attendance/clients/$clientId')
        .replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getGroupAttendance(String classId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/attendance/groups/$classId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateAttendanceRecord(
    String id, {
    required String status,
    String? notes,
  }) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/attendance/$id'),
      headers: _headers(),
      body: jsonEncode({
        'status': status,
        if (notes != null) 'notes': notes,
      }),
    ));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getMyAttendance({
    String? range,
    String? type,
  }) async {
    final params = <String, String>{};
    if (range != null && range.isNotEmpty) params['range'] = range;
    if (type != null && type.isNotEmpty) params['type'] = type;
    final uri = Uri.parse('$baseUrl/user/attendance').replace(queryParameters: params.isEmpty ? null : params);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getMyAttendanceSummary() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/attendance/summary'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getCoachReports() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/reports'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendFeedback(Map<String, dynamic> data) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/coach/feedback'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 201) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getNotifications() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/notifications'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getChatThreads() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/chat/threads'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getChatMessages(
    String threadId, {
    bool markRead = true,
  }) async {
    final uri = Uri.parse(
      '$baseUrl/chat/threads/$threadId',
    ).replace(queryParameters: markRead ? null : {'markRead': 'false'});
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendChatMessage(
    String threadId,
    String body,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/chat/message'),
      headers: _headers(),
      body: jsonEncode({'assignmentId': threadId, 'body': body}),
    ));
    if (response.statusCode == 200 || response.statusCode == 201)
      return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateChatMessage(
    String messageId,
    String body,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/chat/message/$messageId'),
      headers: _headers(),
      body: jsonEncode({'body': body}),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> deleteChatMessage(String messageId) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/chat/message/$messageId'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  // --- User Coaching & Classes ---

  Future<Map<String, dynamic>?> getUserCoaching() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/coaching'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body == null) return null;
      if (body is Map<String, dynamic>) return body;
      if (body is Map) return Map<String, dynamic>.from(body);
      return null;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>?> getMyCoachRequest() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/coach-request'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body == null) return null;
      return body as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<void> cancelCoachRequest() async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/user/coach-request'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> submitCoachRequest({
    required String coachId,
    String? message,
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/coach-request'),
      headers: _headers(),
      body: jsonEncode({
        'coachId': coachId,
        if (message != null && message.isNotEmpty) 'message': message,
      }),
    ));
    if (response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getCoachRequests() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/coach/requests'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as List<dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> approveCoachRequest(
    String id, {
    String? classId,
  }) async {
    final body = <String, dynamic>{};
    if (classId != null && classId.isNotEmpty) {
      body['classId'] = classId;
    }
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/requests/$id/approve'),
      headers: _headers(),
      body: jsonEncode(body),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rejectCoachRequest(String id) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/coach/requests/$id/reject'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getUserClasses() async {
    try {
      final response = await _send(http.get(
        Uri.parse('$baseUrl/user/classes'),
        headers: _headers(),
      ));
      if (response.statusCode == 200) {
        return jsonDecode(response.body) as List<dynamic>;
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<dynamic>> getAvailableClasses() async {
    try {
      final response = await _send(http.get(
        Uri.parse('$baseUrl/user/classes/available'),
        headers: _headers(),
      ));
      if (response.statusCode == 200) {
        return jsonDecode(response.body) as List<dynamic>;
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<Map<String, dynamic>> getUserClassDetail(String classId) async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/classes/$classId'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> joinUserClass(String classId) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/classes/$classId/join'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getUserSessions() async {
    try {
      final response = await _send(http.get(
        Uri.parse('$baseUrl/session'),
        headers: _headers(),
      ));
      if (response.statusCode == 200) {
        return jsonDecode(response.body) as List<dynamic>;
      }
      return [];
    } catch (_) {
      return [];
    }
  }

  Future<List<dynamic>> getUserNotifications() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/notifications'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<void> markUserNotificationRead(String notificationId) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/user/notifications/$notificationId/read'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  // --- Admin Endpoints ---

  Future<Map<String, dynamic>> getAdminDashboardStats() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/dashboard'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  Future<Map<String, dynamic>> getAdminStatistics() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/statistics'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } else {
      throw Exception(_parseError(response));
    }
  }

  // --- Admin Class Management ---

  Future<List<dynamic>> getAdminClasses() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/classes'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createAdminClass(
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/admin/classes'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200 || response.statusCode == 201)
      return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateAdminClass(
    String id,
    Map<String, dynamic> data,
  ) async {
    final response = await _send(http.put(
      Uri.parse('$baseUrl/admin/classes/$id'),
      headers: _headers(),
      body: jsonEncode(data),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<void> deleteAdminClass(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/admin/classes/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  // --- Admin User Management ---

  Future<void> deleteUser(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/admin/users/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<void> deleteCoach(String id) async {
    final response = await _send(http.delete(
      Uri.parse('$baseUrl/admin/trainers/$id'),
      headers: _headers(),
    ));
    if (response.statusCode != 200) throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateUserRole(String id, String role) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/users/$id/role'),
      headers: _headers(),
      body: jsonEncode({'role': role}),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> createAdminUser({
    required String name,
    required String email,
    required String password,
    String role = 'user',
    String? phone,
    int? age,
    String? gender,
    double? heightCm,
    double? weightKg,
    String? fitnessGoal,
    String? location,
    int? yearsExperience,
    String? certifications,
    dynamic specialization,
    String? bio,
    String? experience,
    String? message,
    List<String>? workingDays,
    List<String>? appointmentDays,
    List<Map<String, String>>? dayAvailability,
    int? appointmentDurationMinutes,
    List<Map<String, dynamic>>? certificateFiles,
  }) async {
    final payload = <String, dynamic>{
      'name': name.trim(),
      'full_name': name.trim(),
      'email': PasswordUtils.normalizeEmail(email),
      'username': PasswordUtils.normalizeEmail(email),
      'password': password,
      'role': role,
    };
    if (phone != null) payload['phone'] = phone;
    if (age != null) payload['age'] = age;
    if (gender != null && gender.trim().isNotEmpty) payload['gender'] = gender.trim();
    if (heightCm != null) payload['height'] = heightCm;
    if (weightKg != null) payload['weight'] = weightKg;
    if (fitnessGoal != null && fitnessGoal.trim().isNotEmpty) {
      payload['fitness_goal'] = fitnessGoal.trim();
    }
    if (location != null) payload['location'] = location;
    if (yearsExperience != null) payload['yearsExperience'] = yearsExperience;
    if (certifications != null) payload['certifications'] = certifications;
    if (specialization != null) payload['specialization'] = specialization;
    if (bio != null) payload['bio'] = bio;
    if (experience != null) payload['experience'] = experience;
    if (message != null) payload['message'] = message;
    if (workingDays != null) payload['workingDays'] = workingDays;
    if (appointmentDays != null) payload['appointmentDays'] = appointmentDays;
    if (dayAvailability != null) payload['dayAvailability'] = dayAvailability;
    if (appointmentDurationMinutes != null) {
      payload['appointmentDurationMinutes'] = appointmentDurationMinutes;
    }
    if (certificateFiles != null) payload['certificateFiles'] = certificateFiles;

    final response = await _send(http.post(
      Uri.parse('$baseUrl/admin/users'),
      headers: _headers(),
      body: jsonEncode(payload),
    ));
    if (response.statusCode == 201) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateAdminUser(
    String id, {
    String? name,
    String? email,
  }) async {
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (email != null) body['email'] = email;
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/users/$id'),
      headers: _headers(),
      body: jsonEncode(body),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> updateUserStatus(
    String id,
    String status,
  ) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/users/$id/status'),
      headers: _headers(),
      body: jsonEncode({'status': status}),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> sendAdminAnnouncement({
    required String title,
    required String message,
    required String target,
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/admin/notifications'),
      headers: _headers(),
      body: jsonEncode({'title': title, 'message': message, 'target': target}),
    ));
    if (response.statusCode == 200 || response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> getAdminExercises() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/admin/exercises'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> approveAdminExercise(String id) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/exercises/$id/approve'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rejectAdminExercise(String id) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/exercises/$id/reject'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) return jsonDecode(response.body);
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>?> getMyCoachApplication() async {
    final response = await _send(http.get(
      Uri.parse('$baseUrl/user/coach-application'),
      headers: _headers(),
    ));
    if (response.statusCode == 200) {
      final body = jsonDecode(response.body);
      if (body == null) return null;
      return body as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> submitCoachApplication({
    required String phone,
    required int age,
    required String location,
    required int yearsExperience,
    required String certifications,
    required dynamic specialization,
    required String bio,
    required String experience,
    required String message,
    required List<String> workingDays,
    required List<String> appointmentDays,
    required List<Map<String, String>> dayAvailability,
    int appointmentDurationMinutes = 60,
    List<Map<String, dynamic>> certificateFiles = const [],
  }) async {
    final response = await _send(http.post(
      Uri.parse('$baseUrl/user/coach-application'),
      headers: _headers(),
      body: jsonEncode({
        'phone': phone,
        'age': age,
        'location': location,
        'yearsExperience': yearsExperience,
        'certifications': certifications,
        'specialization': specialization,
        'bio': bio,
        'experience': experience,
        'message': message,
        'workingDays': workingDays,
        'appointmentDays': appointmentDays,
        'dayAvailability': dayAvailability,
        'appointmentDurationMinutes': appointmentDurationMinutes,
        'certificateFiles': certificateFiles,
      }),
    ));
    if (response.statusCode == 200 || response.statusCode == 201) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_parseError(response));
  }

  Future<List<dynamic>> getCoachApplications({String? status}) async {
    final uri = Uri.parse(
      '$baseUrl/admin/coach-applications',
    ).replace(queryParameters: status != null ? {'status': status} : null);
    final response = await _send(http.get(uri, headers: _headers()));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as List<dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> approveCoachApplication(String id) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/coach-applications/$id/approve'),
      headers: _headers(),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  Future<Map<String, dynamic>> rejectCoachApplication(String id, {String reason = ''}) async {
    final response = await _send(http.patch(
      Uri.parse('$baseUrl/admin/coach-applications/$id/reject'),
      headers: _headers(),
      body: jsonEncode({'reason': reason}),
    ));
    if (response.statusCode == 200)
      return jsonDecode(response.body) as Map<String, dynamic>;
    throw Exception(_parseError(response));
  }

  // --- Utility ---

  static bool _isConnectionError(Exception e) {
    final message = e.toString();
    return message.contains('Connection refused') ||
        message.contains('Failed host lookup') ||
        message.contains('SocketException') ||
        message.contains('Network is unreachable');
  }

  Future<Map<String, dynamic>> createShareCard({
    required String type,
    String? title,
    String? level,
  }) async {
    try {
      final response = await _send(http.post(
        Uri.parse('$baseUrl/share/cards'),
        headers: _headers(),
        body: jsonEncode({
          'type': type,
          if (title != null && title.isNotEmpty) 'title': title,
          if (level != null && level.isNotEmpty) 'level': level,
        }),
      ));
      if (response.statusCode == 201) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      throw Exception(_parseError(response));
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  Future<Map<String, dynamic>> getMyInvite() async {
    try {
      final response = await _send(http.get(
        Uri.parse('$baseUrl/share/invite'),
        headers: _headers(),
      ));
      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      throw Exception(_parseError(response));
    } on Exception catch (e) {
      if (!_isConnectionError(e)) rethrow;
      throw Exception(friendlyError(e));
    }
  }

  String _parseError(http.Response response) {
    try {
      final body = jsonDecode(response.body);
      if (body['message'] != null) {
        return body['message'].toString();
      }
      if (body['errors'] != null && body['errors'] is List) {
        final errors = body['errors'] as List;
        if (errors.isNotEmpty) {
          final first = errors[0];
          if (first is Map) {
            final msg = first['message'] ?? first['msg'];
            if (msg != null) return msg.toString();
          }
        }
      }
      return 'Request failed with status ${response.statusCode}';
    } catch (_) {
      return 'Request failed with status ${response.statusCode}';
    }
  }
}
