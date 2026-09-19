// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post_api_v1_care_team_members_id_end_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

PostApiV1CareTeamMembersIdEndResponse
_$PostApiV1CareTeamMembersIdEndResponseFromJson(Map<String, dynamic> json) =>
    PostApiV1CareTeamMembersIdEndResponse(
      data: CareTeamMember.fromJson(json['data'] as Map<String, dynamic>),
      meta: ResponseMeta.fromJson(json['meta'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$PostApiV1CareTeamMembersIdEndResponseToJson(
  PostApiV1CareTeamMembersIdEndResponse instance,
) => <String, dynamic>{'data': instance.data, 'meta': instance.meta};
