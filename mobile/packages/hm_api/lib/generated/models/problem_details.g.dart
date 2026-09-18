// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'problem_details.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ProblemDetails _$ProblemDetailsFromJson(Map<String, dynamic> json) =>
    ProblemDetails(
      code: ErrorCode.fromJson(json['code'] as String),
      message: json['message'] as String,
      requestId: json['requestId'] as String,
      details: json['details'] as Map<String, dynamic>?,
      fieldErrors: (json['fieldErrors'] as List<dynamic>?)
          ?.map((e) => FieldError.fromJson(e as Map<String, dynamic>))
          .toList(),
      retryAfterSeconds: (json['retryAfterSeconds'] as num?)?.toInt(),
    );

Map<String, dynamic> _$ProblemDetailsToJson(ProblemDetails instance) =>
    <String, dynamic>{
      'code': instance.code,
      'details': instance.details,
      'fieldErrors': instance.fieldErrors,
      'message': instance.message,
      'requestId': instance.requestId,
      'retryAfterSeconds': instance.retryAfterSeconds,
    };
