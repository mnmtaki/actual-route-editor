package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;

/**
 * A bounded three-way merge for ONE native line's compound topology mutation.
 *
 * The caller authenticates, locks the project row, validates its revision
 * journal and passes a trusted persisted baseline revision. Any uncertain
 * dependency fails closed. No arbitrary document paths or global settings can
 * be patched through this operation.
 */
final class LineCompoundMerge {
    private final ObjectMapper mapper;
    LineCompoundMerge(ObjectMapper mapper) { this.mapper=mapper; }

    ObjectNode merge(JsonNode before, JsonNode after, JsonNode current, String lineId) {
        require(before.isObject() && after.isObject() && current.isObject(), "工程对象无效");
        ObjectNode baseline=(ObjectNode)before, desired=(ObjectNode)after,
                   latest=(ObjectNode)current;
        for(JsonNode doc:List.of(before,after,current))
            for(String key:List.of("stations","lines","stationLineRelations","openingPhases"))
                require(doc.path(key).isArray(), "工程数组缺失："+key);
        for(JsonNode doc:List.of(before,after,current))
            require(doc.path("geometry").path("segments").isArray(), "区间数组缺失");
        require(globalEqual(baseline,desired), "复合操作修改了全局字段");
        require(lineId!=null && !lineId.isBlank(), "缺少目标线路");
        JsonNode oldLine=find(before.path("lines"),lineId);
        JsonNode newLine=find(after.path("lines"),lineId);
        JsonNode liveLine=find(current.path("lines"),lineId);
        require(oldLine!=null && newLine!=null && liveLine!=null &&
                oldLine.equals(liveLine), "目标线路已被其他用户修改");
        require(newLine.path("lineOrder").equals(oldLine.path("lineOrder")) &&
                newLine.path("parentLineId").equals(oldLine.path("parentLineId")),
                "复合操作不能改变线路排序或父线路归属");
        if(oldLine.path("parentLineId").isTextual()) {
            String parentId=oldLine.path("parentLineId").asText();
            require(Objects.equals(find(before.path("lines"),parentId),
                                   find(current.path("lines"),parentId)),
                    "复合操作所属支线的主线发生变化");
        }
        require(!oldLine.path("locked").asBoolean(false) &&
                !oldLine.path("isFake").asBoolean(false) &&
                !oldLine.has("source") &&
                !newLine.has("source") &&
                oldLine.path("operationHistory").size()==0,
                "来源线路或锁定线路禁止复合合并");
        require(otherLinesEqual(before.path("lines"),after.path("lines"),lineId),
                "复合操作同时修改了其他线路");
        var touchedStations=relatedStations(before,lineId);
        touchedStations.addAll(relatedStations(after,lineId));
        var oldStations=index(before.path("stations"));
        var newStations=index(after.path("stations"));
        var latestStations=index(current.path("stations"));
        require(newStations.size()>=oldStations.size(),"复合操作删除全局车站");
        int changes=0;
        var changedStations=new LinkedHashMap<String,JsonNode>();
        for(var entry:oldStations.entrySet()) {
            JsonNode expected=newStations.get(entry.getKey());
            require(expected!=null,"复合操作删除车站："+entry.getKey());
            if(!expected.equals(entry.getValue())) {
                require(touchedStations.contains(entry.getKey()),
                    "复合操作修改了范围外车站");
                require(!belongsToOtherLine(before,entry.getKey(),lineId) &&
                        !belongsToOtherLine(current,entry.getKey(),lineId),
                    "复合操作修改了共享车站");
                changedStations.put(entry.getKey(),expected);
                changes++;
            }
        }
        for(var entry:newStations.entrySet())
            if(!oldStations.containsKey(entry.getKey())) {
                require(touchedStations.contains(entry.getKey()),
                    "复合操作新增了未使用车站");
                require(!latestStations.containsKey(entry.getKey()),
                    "新车站 ID 已被并发使用");
                changedStations.put(entry.getKey(),entry.getValue());
                changes++;
            }
        for(String id:touchedStations)
            if(oldStations.containsKey(id))
                require(Objects.equals(oldStations.get(id),latestStations.get(id)),
                    "相关车站已被并发修改");
        // A different line attaching to one of the target's existing stations
        // changes the transfer topology even if the station object itself is
        // unchanged. Reject this race rather than dropping the new membership.
        for(String id:touchedStations)
            if(oldStations.containsKey(id))
                require(crossMembershipEqual(before,current,id,lineId),
                    "共享车站关联已变化");

        for(String collection:List.of("stationLineRelations","openingPhases")) {
            require(otherOwnedEqual(before.path(collection),after.path(collection),lineId),
                    "复合操作修改了其他线路："+collection);
            require(ownedEqual(before.path(collection),current.path(collection),lineId),
                    "当前线路的关联或分期发生并发修改");
        }
        JsonNode beforeSegments=before.path("geometry").path("segments");
        JsonNode afterSegments=after.path("geometry").path("segments");
        JsonNode currentSegments=current.path("geometry").path("segments");
        require(otherOwnedEqual(beforeSegments,afterSegments,lineId),
                "复合操作修改了其他线路区间");
        require(ownedEqual(beforeSegments,currentSegments,lineId),
                "当前线路区间已经发生并发修改");
        require(changes + scoped(afterSegments,lineId).size() +
                scoped(after.path("stationLineRelations"),lineId).size() +
                scoped(after.path("openingPhases"),lineId).size() <= 1200,
                "复合事务超出对象数量限制");
        ObjectNode result=latest.deepCopy();
        ArrayNode lines=(ArrayNode)result.path("lines");
        for(int i=0;i<lines.size();i++)
            if(lineId.equals(lines.get(i).path("id").asText()))
                lines.set(i,newLine.deepCopy());
        for(String collection:List.of("stationLineRelations","openingPhases"))
            result.set(collection,combineScoped(result.path(collection),
                after.path(collection),lineId));
        ((ObjectNode)result.path("geometry")).set("segments",
            combineScoped(result.path("geometry").path("segments"),
                afterSegments,lineId));
        ArrayNode stations=(ArrayNode)result.path("stations");
        var replaced=new HashSet<String>();
        for(int i=0;i<stations.size();i++) {
            String id=stations.get(i).path("id").asText();
            if(changedStations.containsKey(id)) {
                stations.set(i,changedStations.get(id).deepCopy());
                replaced.add(id);
            }
        }
        for(var entry:changedStations.entrySet())
            if(!replaced.contains(entry.getKey()))
                stations.add(entry.getValue().deepCopy());
        validateRefs(result,lineId);
        return result;
    }

    private boolean globalEqual(ObjectNode a,ObjectNode b) {
        ObjectNode left=a.deepCopy(),right=b.deepCopy();
        for(String field:List.of("stations","lines","stationLineRelations","openingPhases")) {
            left.set(field,mapper.createArrayNode());
            right.set(field,mapper.createArrayNode());
        }
        ((ObjectNode)left.path("geometry")).set("segments",mapper.createArrayNode());
        ((ObjectNode)right.path("geometry")).set("segments",mapper.createArrayNode());
        return left.equals(right);
    }
    private JsonNode find(JsonNode array,String id) {
        for(JsonNode item:array)if(id.equals(item.path("id").asText()))return item;
        return null;
    }
    private Map<String,JsonNode> index(JsonNode array) {
        var map=new LinkedHashMap<String,JsonNode>();
        for(JsonNode item:array) {
            String id=item.path("id").asText("");
            require(!id.isEmpty() && map.putIfAbsent(id,item)==null,
                "复合事务存在空 ID 或重复 ID");
        }
        return map;
    }
    private List<JsonNode> scoped(JsonNode array,String lineId) {
        var results=new ArrayList<JsonNode>();
        for(JsonNode item:array)
            if(lineId.equals(item.path("lineId").asText()))
                results.add(item);
        return results;
    }
    private boolean ownedEqual(JsonNode a,JsonNode b,String lineId) {
        return scoped(a,lineId).equals(scoped(b,lineId));
    }
    private boolean otherOwnedEqual(JsonNode a,JsonNode b,String lineId) {
        var x=new LinkedHashMap<String,JsonNode>();
        var y=new LinkedHashMap<String,JsonNode>();
        for(JsonNode item:a)
            if(!lineId.equals(item.path("lineId").asText()))
                x.put(item.path("id").asText(),item);
        for(JsonNode item:b)
            if(!lineId.equals(item.path("lineId").asText()))
                y.put(item.path("id").asText(),item);
        return x.equals(y);
    }
    private boolean otherLinesEqual(JsonNode a,JsonNode b,String lineId) {
        var x=new LinkedHashMap<String,JsonNode>();
        var y=new LinkedHashMap<String,JsonNode>();
        for(JsonNode item:a)
            if(!lineId.equals(item.path("id").asText()))
                x.put(item.path("id").asText(),item);
        for(JsonNode item:b)
            if(!lineId.equals(item.path("id").asText()))
                y.put(item.path("id").asText(),item);
        return x.equals(y);
    }
    private Set<String> relatedStations(JsonNode doc,String lineId) {
        var result=new HashSet<String>();
        JsonNode line=find(doc.path("lines"),lineId);
        if(line!=null)
            for(JsonNode id:line.path("stationSequence"))result.add(id.asText());
        for(JsonNode relation:doc.path("stationLineRelations"))
            if(lineId.equals(relation.path("lineId").asText()))
                result.add(relation.path("stationId").asText());
        for(JsonNode segment:doc.path("geometry").path("segments"))
            if(lineId.equals(segment.path("lineId").asText())) {
                result.add(segment.path("fromStationId").asText());
                result.add(segment.path("toStationId").asText());
            }
        return result;
    }
    private boolean belongsToOtherLine(JsonNode doc,String stationId,String lineId) {
        for(JsonNode rel:doc.path("stationLineRelations"))
            if(stationId.equals(rel.path("stationId").asText()) &&
                !lineId.equals(rel.path("lineId").asText()))return true;
        return false;
    }
    private boolean crossMembershipEqual(JsonNode before,JsonNode current,
                                         String stationId,String lineId) {
        var a=new LinkedHashMap<String,JsonNode>(),b=new LinkedHashMap<String,JsonNode>();
        for(JsonNode rel:before.path("stationLineRelations"))
            if(stationId.equals(rel.path("stationId").asText()) &&
               !lineId.equals(rel.path("lineId").asText()))
                a.put(rel.path("id").asText(),rel);
        for(JsonNode rel:current.path("stationLineRelations"))
            if(stationId.equals(rel.path("stationId").asText()) &&
               !lineId.equals(rel.path("lineId").asText()))
                b.put(rel.path("id").asText(),rel);
        return a.equals(b);
    }
    private ArrayNode combineScoped(JsonNode current,JsonNode desired,String lineId) {
        var result=mapper.createArrayNode();
        boolean inserted=false;
        var replacements=scoped(desired,lineId);
        for(JsonNode item:current) {
            if(lineId.equals(item.path("lineId").asText())) {
                if(!inserted) {
                    for(JsonNode replace:replacements)result.add(replace.deepCopy());
                    inserted=true;
                }
            } else result.add(item.deepCopy());
        }
        if(!inserted)for(JsonNode replace:replacements)result.add(replace.deepCopy());
        return result;
    }
    private void validateRefs(JsonNode doc,String lineId) {
        index(doc.path("stations"));
        index(doc.path("lines"));
        index(doc.path("stationLineRelations"));
        index(doc.path("geometry").path("segments"));
        index(doc.path("openingPhases"));
        var stations=index(doc.path("stations"));
        var segments=index(doc.path("geometry").path("segments"));
        var relations=index(doc.path("stationLineRelations"));
        JsonNode line=find(doc.path("lines"),lineId);
        require(line.path("stationSequence").isArray(),"线路站序格式无效");
        var membershipIds=new HashSet<String>();
        for(JsonNode rel:scoped(doc.path("stationLineRelations"),lineId))
            require(membershipIds.add(rel.path("stationId").asText()),
                "线路存在重复车站成员关系");
        var sequenceIds=new HashSet<String>();
        for(JsonNode id:line.path("stationSequence"))
            require(sequenceIds.add(id.asText()) &&
                    stations.containsKey(id.asText()) &&
                    membershipIds.contains(id.asText()),
                    "线路站序存在重复或无效车站");
        for(JsonNode station:doc.path("stations")) {
            String id=station.path("id").asText("");
            require(!id.isEmpty() && id.length()<=128,
                "车站 ID 无效");
            if(!Double.isFinite(station.path("x").asDouble(Double.NaN)) ||
               !Double.isFinite(station.path("y").asDouble(Double.NaN)))
                throw new IllegalArgumentException("车站坐标无效");
        }
        for(JsonNode rel:scoped(doc.path("stationLineRelations"),lineId))
            require(stations.containsKey(rel.path("stationId").asText()),
                "线路关联引用了不存在的车站");
        for(JsonNode seg:scoped(doc.path("geometry").path("segments"),lineId)) {
            String from=seg.path("fromStationId").asText();
            String to=seg.path("toStationId").asText();
            require(stations.containsKey(from) && stations.containsKey(to) &&
                    membershipIds.contains(from) && membershipIds.contains(to) &&
                    !from.equals(to),"区间引用了不属于本线的端点");
            require(seg.path("waypoints").isArray() &&
                    java.util.Set.of("straight","smooth").contains(
                        seg.path("mode").asText("")),"区间几何格式无效");
            var waypointIds=new HashSet<String>();
            for(JsonNode waypoint:seg.path("waypoints"))
                require(waypoint.path("id").isTextual() &&
                        waypointIds.add(waypoint.path("id").asText()) &&
                        Double.isFinite(waypoint.path("x").asDouble(Double.NaN)) &&
                        Double.isFinite(waypoint.path("y").asDouble(Double.NaN)),
                        "区间控制点格式无效");
        }
        for(JsonNode phase:scoped(doc.path("openingPhases"),lineId)) {
            for(JsonNode id:phase.path("segmentIds"))
                require(segments.containsKey(id.asText()) &&
                    lineId.equals(segments.get(id.asText()).path("lineId").asText()),
                    "分期区间 ID 无效");
            for(JsonNode id:phase.path("stationRelationIds"))
                require(relations.containsKey(id.asText()) &&
                    lineId.equals(relations.get(id.asText()).path("lineId").asText()),
                    "分期站点关联无效");
        }
    }
    private void require(boolean ok,String reason) {
        if(!ok)throw new IllegalArgumentException(reason);
    }
}
