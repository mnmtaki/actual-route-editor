package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LineCompoundMergeTest {
    private final ObjectMapper mapper=new ObjectMapper();
    private final LineCompoundMerge merger=new LineCompoundMerge(mapper);

    private ObjectNode base() throws Exception {
        return (ObjectNode)mapper.readTree("""
            {"version":1,"name":"Parallel Composite",
             "stations":[{"id":"a","name":"A","x":0,"y":0},
                         {"id":"b","name":"B","x":100,"y":0},
                         {"id":"c","name":"C","x":200,"y":0}],
             "lines":[
               {"id":"l1","name":"One","color":"#123456",
                "lineOrder":0,"visible":true,"locked":false,
                "stationSequence":["a","b"]},
               {"id":"l2","name":"Two","color":"#654321",
                "lineOrder":1,"visible":true,"locked":false,
                "stationSequence":["c"]}],
             "stationLineRelations":[
               {"id":"ra","lineId":"l1","stationId":"a"},
               {"id":"rb","lineId":"l1","stationId":"b"},
               {"id":"rc","lineId":"l2","stationId":"c"}],
             "geometry":{"segments":[
               {"id":"ab","lineId":"l1","fromStationId":"a",
                "toStationId":"b","mode":"straight",
                "structureType":"underground","waypoints":[]}]},
             "openingPhases":[]}
            """);
    }

    @Test
    void compoundGeometryKeepsConcurrentOtherLineEdit() throws Exception {
        ObjectNode before=base(),after=before.deepCopy(),remote=before.deepCopy();
        ObjectNode segment=(ObjectNode)after.path("geometry").path("segments").get(0);
        segment.put("mode","smooth");
        segment.set("waypoints",mapper.readTree("""
            [{"id":"curve","x":50,"y":20,"type":"smooth"}]
            """));
        ((ObjectNode)remote.path("lines").get(1)).put("name","Remote Two");
        ObjectNode merged=merger.merge(before,after,remote,"l1");
        assertEquals("Remote Two",merged.path("lines").get(1).path("name").asText());
        assertEquals("smooth",merged.path("geometry").path("segments")
            .get(0).path("mode").asText());
        assertEquals("curve",merged.path("geometry").path("segments")
            .get(0).path("waypoints").get(0).path("id").asText());
    }

    @Test
    void compoundCanChangeMultipleSegmentsAndPhaseAtomically() throws Exception {
        ObjectNode before=base(),after=before.deepCopy();
        ((ObjectNode)after.path("lines").get(0)).withArray("stationSequence").add("c");
        ((com.fasterxml.jackson.databind.node.ArrayNode)after.path("stationLineRelations"))
            .add(mapper.readTree("""
                {"id":"r1c","lineId":"l1","stationId":"c"}
                """));
        ((com.fasterxml.jackson.databind.node.ArrayNode)after.path("geometry").path("segments"))
            .add(mapper.readTree("""
                {"id":"bc","lineId":"l1","fromStationId":"b",
                 "toStationId":"c","mode":"straight",
                 "structureType":"underground","waypoints":[]}
                """));
        ObjectNode merged=merger.merge(before,after,before,"l1");
        assertEquals(2,merged.path("geometry").path("segments").size());
        assertEquals(3,merged.path("lines").get(0).path("stationSequence").size());
        assertEquals(4,merged.path("stationLineRelations").size());
    }

    @Test
    void refusesSharedStationMoveAndConcurrentSameLineChanges() throws Exception {
        ObjectNode before=base(),after=before.deepCopy(),remote=before.deepCopy();
        ((ObjectNode)after.path("stations").get(0)).put("x",10);
        ((ObjectNode)after.path("geometry").path("segments").get(0)).put("mode","smooth");
        ((ObjectNode)remote.path("stations").get(0)).put("x",7);
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,after,remote,"l1"));

        ObjectNode shared=before.deepCopy();
        ((com.fasterxml.jackson.databind.node.ArrayNode)shared.path("stationLineRelations"))
            .add(mapper.readTree("""
                {"id":"other-a","lineId":"l2","stationId":"a"}
                """));
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,after,shared,"l1"));
        ObjectNode changedLine=before.deepCopy();
        ((ObjectNode)changedLine.path("lines").get(0)).put("name","Overlapping edit");
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,after,changedLine,"l1"));
    }

    @Test
    void refusesCrossLineEditsMissingMembershipsAndGlobalChanges() throws Exception {
        ObjectNode before=base(),after=before.deepCopy();
        ((ObjectNode)after.path("lines").get(1)).put("name","Touched Other Line");
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,after,before,"l1"));
        ObjectNode missing=before.deepCopy();
        ((com.fasterxml.jackson.databind.node.ArrayNode)missing.path("stationLineRelations"))
            .remove(0);
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,missing,before,"l1"));
        ObjectNode global=before.deepCopy();
        global.put("name","Unauthorized global edit");
        assertThrows(IllegalArgumentException.class,()->
            merger.merge(before,global,before,"l1"));
    }
}
