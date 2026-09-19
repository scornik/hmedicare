// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'duplicate_check_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DuplicateCheckRequest _$DuplicateCheckRequestFromJson(
  Map<String, dynamic> json,
) => DuplicateCheckRequest(
  legalName: json['legalName'] as String,
  phones:
      (json['phones'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      const [],
  birthYear: (json['birthYear'] as num?)?.toInt(),
  dateOfBirth: json['dateOfBirth'] as String?,
  excludePatientId: json['excludePatientId'] as String?,
  legalNameBn: json['legalNameBn'] as String?,
);

Map<String, dynamic> _$DuplicateCheckRequestToJson(
  DuplicateCheckRequest instance,
) => <String, dynamic>{
  'birthYear': ?instance.birthYear,
  'dateOfBirth': ?instance.dateOfBirth,
  'excludePatientId': ?instance.excludePatientId,
  'legalName': instance.legalName,
  'legalNameBn': ?instance.legalNameBn,
  'phones': instance.phones,
};
