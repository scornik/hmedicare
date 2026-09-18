// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'response_meta.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ResponseMeta _$ResponseMetaFromJson(Map<String, dynamic> json) => ResponseMeta(
  requestId: json['requestId'] as String,
  replayed: json['replayed'] as bool?,
);

Map<String, dynamic> _$ResponseMetaToJson(ResponseMeta instance) =>
    <String, dynamic>{
      'replayed': instance.replayed,
      'requestId': instance.requestId,
    };
