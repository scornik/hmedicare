// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'patient_account_list_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PatientAccountListResponse _$PatientAccountListResponseFromJson(
  Map<String, dynamic> json,
) => PatientAccountListResponse(
  hasMore: json['hasMore'] as bool,
  items: (json['items'] as List<dynamic>)
      .map((e) => PatientAccount.fromJson(e as Map<String, dynamic>))
      .toList(),
  nextCursor: json['nextCursor'] as String?,
);

Map<String, dynamic> _$PatientAccountListResponseToJson(
  PatientAccountListResponse instance,
) => <String, dynamic>{
  'hasMore': instance.hasMore,
  'items': instance.items,
  'nextCursor': ?instance.nextCursor,
};
