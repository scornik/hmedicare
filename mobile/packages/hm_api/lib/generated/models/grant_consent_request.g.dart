// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'grant_consent_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

GrantConsentRequest _$GrantConsentRequestFromJson(Map<String, dynamic> json) =>
    GrantConsentRequest(
      purpose: GrantConsentRequestPurpose.fromJson(json['purpose'] as String),
      policyVersion: (json['policyVersion'] as num?)?.toInt() ?? 1,
      evidenceRef: json['evidenceRef'] as String?,
    );

Map<String, dynamic> _$GrantConsentRequestToJson(
  GrantConsentRequest instance,
) => <String, dynamic>{
  'evidenceRef': ?instance.evidenceRef,
  'policyVersion': instance.policyVersion,
  'purpose': instance.purpose,
};
