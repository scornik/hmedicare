// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data4.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data4 _$Data4FromJson(Map<String, dynamic> json) => Data4(
  sessionId: json['sessionId'] as String,
  status: Status4.fromJson(json['status'] as String),
);

Map<String, dynamic> _$Data4ToJson(Data4 instance) => <String, dynamic>{
  'sessionId': instance.sessionId,
  'status': instance.status,
};
