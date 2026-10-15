// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_credential_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiCredentialList _$AiCredentialListFromJson(Map<String, dynamic> json) =>
    AiCredentialList(
      items: (json['items'] as List<dynamic>)
          .map((e) => AiCredential.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$AiCredentialListToJson(AiCredentialList instance) =>
    <String, dynamic>{'items': instance.items};
