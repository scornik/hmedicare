// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'field_error.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FieldError _$FieldErrorFromJson(Map<String, dynamic> json) => FieldError(
  code: json['code'] as String,
  message: json['message'] as String,
  path: json['path'] as String,
);

Map<String, dynamic> _$FieldErrorToJson(FieldError instance) =>
    <String, dynamic>{
      'code': instance.code,
      'message': instance.message,
      'path': instance.path,
    };
