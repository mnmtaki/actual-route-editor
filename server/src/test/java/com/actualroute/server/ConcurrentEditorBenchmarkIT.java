package com.actualroute.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.Cookie;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * Opt-in, real JDBC + Spring Security + project-row-lock benchmark.
 * Uses a disposable PostgreSQL database. NEVER point this at production.
 * Start with: ARA_RUN_CONCURRENCY_BENCH=true mvn -Dtest=ConcurrentEditorBenchmarkIT test
 */
@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named="ARA_RUN_CONCURRENCY_BENCH", matches="true")
class ConcurrentEditorBenchmarkIT {
    @Autowired MockMvc mvc;
    @Autowired AuthService auth;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    record Actor(UUID id, Cookie[] cookies, String csrf) {}
    record Outcome(int status, double millis, String detail) {}
    record Result(String scenario, int clients, long elapsedMs, double throughput,
                  double p50Ms, double p95Ms, int successes, int conflicts,
                  int errors, long finalRevision, long journalRows, int finalStations,
                  int finalSegments) {}

    @Test
    void measureAndVerifyIndependentWritesAt10_20_50Clients() throws Exception {
        String jdbcUrl;
        try(var connection=Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            jdbcUrl=Objects.toString(connection.getMetaData().getURL(),"");
        }
        assertTrue(jdbcUrl.contains("actual_route_bench"),
            "Benchmark requires its dedicated isolated actual_route_bench database");
        var actors=new ArrayList<Actor>();
        for(int i=0;i<50;i++)actors.add(createActor(i));
        var results=new ArrayList<Result>();
        for(int concurrency:new int[]{10,20,50}) {
            results.add(run("station.create",concurrency,actors));
            results.add(run("line.append-new",concurrency,actors));
        }
        ObjectNode report=mapper.createObjectNode();
        report.put("source","ConcurrentEditorBenchmarkIT");
        report.put("note","Real MockMvc/PostgreSQL requests; local CI runner; time excludes account setup");
        report.put("durationMetric","Per-request wall-clock including authentication, row-lock wait and database writes");
        report.set("results",mapper.valueToTree(results));
        Path file=Path.of("target","concurrency-benchmark.json");
        Files.createDirectories(file.getParent());
        Files.writeString(file,mapper.writerWithDefaultPrettyPrinter().writeValueAsString(report));
        System.out.println("CONCURRENCY_BENCHMARK_JSON "+report.toString());
        String summary=System.getenv("GITHUB_STEP_SUMMARY");
        if(summary!=null && !summary.isBlank()) {
            var lines=new StringBuilder("\n### Actual Route editor: real concurrent MockMvc / PostgreSQL benchmark\n\n")
                .append("| Scenario | Concurrent users | P50 ms | P95 ms | Ops/s | OK | 409 | Unexpected |\n")
                .append("|---|---:|---:|---:|---:|---:|---:|---:|\n");
            for(Result r:results)lines.append(String.format(Locale.ROOT,
                "| %s | %d | %.1f | %.1f | %.2f | %d | %d | %d |%n",
                r.scenario(),r.clients(),r.p50Ms(),r.p95Ms(),r.throughput(),
                r.successes(),r.conflicts(),r.errors()));
            Files.writeString(Path.of(summary),lines.toString(),
                java.nio.file.StandardOpenOption.CREATE,
                java.nio.file.StandardOpenOption.APPEND);
        }
    }

    private Actor createActor(int index) {
        String username="bench"+UUID.randomUUID().toString().replace("-","").substring(0,20);
        String password="bench-password-very-long";
        auth.register(username,password);
        AuthService.IssuedSession issued=auth.login(username,password);
        return new Actor(auth.resolve(issued.token()),new Cookie[]{
            new Cookie("ara_session",issued.token()),
            new Cookie("ara_csrf",issued.csrf())},issued.csrf());
    }

    private Result run(String scenario,int concurrency,List<Actor> actors) throws Exception {
        UUID project=UUID.randomUUID();
        ObjectNode seed=seed(concurrency);
        String raw=mapper.writeValueAsString(seed);
        jdbc.update("""
            INSERT INTO cloud_projects(id,owner_id,name,document,revision,visibility)
            VALUES(?,?,?,CAST(? AS jsonb),1,'public_edit')
            """,project,actors.get(0).id(),"Benchmark",raw);
        jdbc.update("""
            INSERT INTO cloud_project_revisions(project_id,revision,name,document)
            VALUES(?,1,'Benchmark',CAST(? AS jsonb))
            """,project,raw);
        var executor=Executors.newFixedThreadPool(concurrency);
        var ready=new CountDownLatch(concurrency);
        var fire=new CountDownLatch(1);
        var futures=new ArrayList<Future<Outcome>>();
        try {
            for(int i=0;i<concurrency;i++) {
                final int userIndex=i;
                futures.add(executor.submit(()->{
                    ready.countDown();
                    if(!fire.await(20,TimeUnit.SECONDS))
                        throw new IllegalStateException("start barrier timed out");
                    long start=System.nanoTime();
                    try {
                        String path="/api/projects/"+project+"/operations";
                        ObjectNode payload=mapper.createObjectNode();
                        payload.put("operationId",UUID.randomUUID().toString());
                        payload.put("expectedRevision",1);
                        if(scenario.equals("station.create")) {
                            payload.put("type","station.create");
                            ObjectNode station=payload.putObject("station");
                            station.put("id","new-"+userIndex);
                            station.put("name","New "+userIndex);
                            station.put("x",500+userIndex);
                            station.put("y",200+userIndex);
                        } else {
                            path+="/line-append-new";
                            payload.put("lineId","line-"+userIndex);
                            payload.put("fromStationId","anchor-"+userIndex);
                            ObjectNode station=payload.putObject("station");
                            station.put("id","new-"+userIndex);
                            station.put("name","New "+userIndex);
                            station.put("x",500+userIndex);
                            station.put("y",200+userIndex);
                            station.put("labelOffsetX",14);
                            station.put("labelOffsetY",-14);
                            ObjectNode relation=payload.putObject("relation");
                            relation.put("id","new-rel-"+userIndex);
                            relation.put("lineId","line-"+userIndex);
                            relation.put("stationId","new-"+userIndex);
                            relation.putNull("openedAt");
                            relation.putNull("closedAt");
                            ObjectNode segment=payload.putObject("segment");
                            segment.put("id","new-segment-"+userIndex);
                            segment.put("lineId","line-"+userIndex);
                            segment.put("fromStationId","anchor-"+userIndex);
                            segment.put("toStationId","new-"+userIndex);
                            segment.put("mode","straight");
                            segment.put("structureType","underground");
                            segment.set("waypoints",mapper.createArrayNode());
                            segment.set("structureNodes",mapper.createArrayNode());
                            segment.putNull("openedAt");
                            segment.putNull("closedAt");
                        }
                        var result=mvc.perform(post(path)
                            .cookie(actors.get(userIndex).cookies())
                            .header("X-ARA-CSRF",actors.get(userIndex).csrf())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(payload.toString())).andReturn().getResponse();
                        return new Outcome(result.getStatus(),(System.nanoTime()-start)/1e6,
                            result.getContentAsString().substring(0,Math.min(200,
                                result.getContentAsString().length())));
                    } catch(Exception ex) {
                        return new Outcome(0,(System.nanoTime()-start)/1e6,ex.toString());
                    }
                }));
            }
            assertTrue(ready.await(20,TimeUnit.SECONDS),"workers could not reach start barrier");
            long wallStart=System.nanoTime();
            fire.countDown();
            var outcomes=new ArrayList<Outcome>();
            for(var future:futures)outcomes.add(future.get(120,TimeUnit.SECONDS));
            long elapsed=Math.max(1,TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-wallStart));
            var durations=outcomes.stream().map(Outcome::millis).sorted().toList();
            int ok=(int)outcomes.stream().filter(o->o.status()==200).count();
            int conflicts=(int)outcomes.stream().filter(o->o.status()==409).count();
            int errors=concurrency-ok-conflicts;
            long revision=jdbc.queryForObject("SELECT revision FROM cloud_projects WHERE id=?",
                Long.class,project);
            long journal=jdbc.queryForObject("""
                SELECT count(*) FROM cloud_project_operations WHERE project_id=?
                """,Long.class,project);
            JsonNode finalDoc=mapper.readTree(jdbc.queryForObject("""
                SELECT document::text FROM cloud_projects WHERE id=?
                """,String.class,project));
            int stations=finalDoc.path("stations").size();
            int segments=finalDoc.path("geometry").path("segments").size();
            var record=new Result(scenario,concurrency,elapsed,ok*1000.0/elapsed,
                percentile(durations,0.50),percentile(durations,0.95),
                ok,conflicts,errors,revision,journal,stations,segments);
            System.out.println("BENCHMARK "+mapper.writeValueAsString(record));
            assertEquals(0,errors,"Unexpected HTTP errors: "+outcomes);
            assertEquals(concurrency,ok,"All disjoint writes must commit, statuses: "+outcomes);
            assertEquals(0,conflicts,"Distinct resources must not conflict");
            assertEquals(1+concurrency,revision,"Lost update / invalid revision count");
            assertEquals(concurrency,journal,"Missing or duplicated operation journal");
            assertEquals(300+concurrency,stations,"Missing / duplicated station in document");
            assertEquals(scenario.equals("line.append-new")?concurrency:0,segments);
            var unique=new HashSet<String>();
            for(JsonNode station:finalDoc.path("stations"))
                assertTrue(unique.add(station.path("id").asText()),"Duplicate station ID");
            if(scenario.equals("line.append-new")) {
                for(int i=0;i<concurrency;i++) {
                    JsonNode line=finalDoc.path("lines").get(i);
                    assertEquals("new-"+i,line.path("stationSequence").get(1).asText());
                }
            }
            return record;
        } finally {
            fire.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(10,TimeUnit.SECONDS),
                "stuck benchmark worker");
        }
    }

    private ObjectNode seed(int concurrency) {
        ObjectNode doc=mapper.createObjectNode();
        doc.put("version",1);
        doc.put("name","Benchmark");
        ArrayNode stations=doc.putArray("stations");
        ArrayNode lines=doc.putArray("lines");
        ArrayNode relations=doc.putArray("stationLineRelations");
        ObjectNode geom=doc.putObject("geometry");
        geom.set("segments",mapper.createArrayNode());
        doc.set("openingPhases",mapper.createArrayNode());
        for(int i=0;i<300;i++) {
            ObjectNode station=stations.addObject();
            station.put("id",i<concurrency?"anchor-"+i:"background-"+i);
            station.put("name","Station "+i);
            station.put("x",i*10);
            station.put("y",i*3);
        }
        for(int i=0;i<concurrency;i++) {
            ObjectNode line=lines.addObject();
            line.put("id","line-"+i);
            line.put("name","Line "+i);
            line.put("color","#112233");
            line.put("lineOrder",i);
            line.put("visible",true);
            line.put("locked",false);
            line.putArray("stationSequence").add("anchor-"+i);
            ObjectNode rel=relations.addObject();
            rel.put("id","rel-"+i);
            rel.put("lineId","line-"+i);
            rel.put("stationId","anchor-"+i);
            rel.putNull("openedAt");
            rel.putNull("closedAt");
        }
        return doc;
    }

    private static double percentile(List<Double> sorted,double fraction) {
        int index=(int)Math.ceil(sorted.size()*fraction)-1;
        return sorted.get(Math.max(0,Math.min(index,sorted.size()-1)));
    }
}
