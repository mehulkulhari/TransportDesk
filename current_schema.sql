--
-- PostgreSQL database dump
--

\restrict maEVUj4qvtOcMgBXml9qtWCFB3hHtA6ENfy0VqCBqLYFG9ZdRHhETOxXXucan5N

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

-- Started on 2026-08-06 13:17:51

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 121 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- TOC entry 5785 (class 0 OID 0)
-- Dependencies: 121
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- TOC entry 1887 (class 1255 OID 25738)
-- Name: assign_impact(double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.assign_impact(p_lat double precision, p_lon double precision, p_n integer DEFAULT 4) RETURNS TABLE(bus_id integer, detour_m double precision, detour_km numeric, extra_annual_fuel numeric, detour_min numeric, student_km_school numeric, student_min_school numeric, riders bigint, effective_capacity integer, seats_left integer, has_room boolean, recommended boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
WITH prm AS (SELECT working_days wd, trips_per_day tp, diesel_per_l dp, road_factor rf FROM transport_params LIMIT 1),
sch AS (SELECT ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography g FROM schools LIMIT 1),
spd AS (SELECT kmph v FROM fleet_speed),
pt AS (SELECT ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography g),
seq AS (
  SELECT e.bus_id, COALESCE(e.pickup_order,9999) ord,
         ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)::geography g
  FROM student_effective e WHERE e.latitude IS NOT NULL
  UNION ALL
  SELECT b.bus_id, 2000000 ord, (SELECT g FROM sch) FROM buses b),
ordered AS (SELECT bus_id, g, row_number() OVER (PARTITION BY bus_id ORDER BY ord) rn FROM seq),
pairs AS (SELECT bus_id, g a, LEAD(g) OVER (PARTITION BY bus_id ORDER BY rn) b FROM ordered),
ins AS (SELECT bus_id, MIN(ST_Distance(a,(SELECT g FROM pt))+ST_Distance((SELECT g FROM pt),b)-ST_Distance(a,b)) detour_m
        FROM pairs WHERE b IS NOT NULL GROUP BY bus_id),
calc AS (
  SELECT i.bus_id, GREATEST(i.detour_m,0) dm, GREATEST(i.detour_m,0)/1000 dkm,
         c.riders, c.effective_capacity, (c.effective_capacity-c.riders)::int seats_left,
         bu.mileage
  FROM ins i JOIN bus_capacity c ON c.bus_id=i.bus_id JOIN buses bu ON bu.bus_id=i.bus_id)
SELECT calc.bus_id, round(dm) dm2, round(dkm::numeric,2) dkm2,
  round((dkm*(SELECT tp FROM prm)*(SELECT wd FROM prm)/NULLIF(mileage,0)*(SELECT dp FROM prm))::numeric,0) extra_annual_fuel,
  round((dkm/(SELECT v FROM spd)*60)::numeric,1) detour_min,
  round((ST_Distance((SELECT g FROM pt),(SELECT g FROM sch))/1000*(SELECT rf FROM prm))::numeric,2) student_km_school,
  round((ST_Distance((SELECT g FROM pt),(SELECT g FROM sch))/1000*(SELECT rf FROM prm)/(SELECT v FROM spd)*60)::numeric,0) student_min_school,
  riders, effective_capacity, seats_left, (seats_left>0),
  (calc.bus_id=(SELECT bus_id FROM calc WHERE seats_left>0 ORDER BY dm LIMIT 1))
FROM calc ORDER BY dm LIMIT p_n;
$$;


ALTER FUNCTION public.assign_impact(p_lat double precision, p_lon double precision, p_n integer) OWNER TO postgres;

--
-- TOC entry 1885 (class 1255 OID 25662)
-- Name: duplicate_pickup_locations(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.duplicate_pickup_locations() RETURNS TABLE(latitude double precision, longitude double precision, n bigint, students text)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT latitude, longitude, count(*) n, string_agg(name||' ('||bus_no||')', ', ')
  FROM students WHERE latitude IS NOT NULL
  GROUP BY latitude, longitude HAVING count(*)>1 ORDER BY count(*) DESC;
$$;


ALTER FUNCTION public.duplicate_pickup_locations() OWNER TO postgres;

--
-- TOC entry 1882 (class 1255 OID 25657)
-- Name: move_bus(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.move_bus(p_from integer, p_to integer) RETURNS json
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE moved int; cap int; now_on int;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM buses WHERE bus_id=p_to) THEN
    RETURN json_build_object('ok',false,'msg','target bus does not exist'); END IF;
  -- moving to a new route invalidates the old pickup order
  UPDATE students SET bus_no=p_to, pickup_order=NULL WHERE bus_no=p_from;
  GET DIAGNOSTICS moved = ROW_COUNT;
  SELECT capacity INTO cap FROM buses WHERE bus_id=p_to;
  SELECT count(*) INTO now_on FROM students WHERE bus_no=p_to;
  RETURN json_build_object('ok',true,'moved',moved,'now_on_target',now_on,
    'capacity',cap,'over_capacity',(now_on>cap));
END $$;


ALTER FUNCTION public.move_bus(p_from integer, p_to integer) OWNER TO postgres;

--
-- TOC entry 1888 (class 1255 OID 25739)
-- Name: move_students_impact(text[], integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.move_students_impact(p_srs text[], p_to integer) RETURNS TABLE(role text, bus_id integer, moved integer, current_riders bigint, new_riders bigint, effective_capacity integer, over_capacity boolean, delta_route_km numeric, delta_annual_fuel numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
WITH prm AS (SELECT working_days wd, trips_per_day tp, diesel_per_l dp FROM transport_params LIMIT 1),
sch AS (SELECT ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography g FROM schools LIMIT 1),
movers AS (  -- the students being moved, with their point + current bus
  SELECT s.sr_no, s.bus_no AS from_bus,
         ST_SetSRID(ST_MakePoint(s.longitude,s.latitude),4326)::geography g
  FROM students s WHERE s.sr_no = ANY(p_srs) AND s.latitude IS NOT NULL),
-- ordered stops with neighbours, for removal-saving on source buses
ord AS (
  SELECT e.bus_id, e.sr_no, ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)::geography g,
         row_number() OVER (PARTITION BY e.bus_id ORDER BY COALESCE(e.pickup_order,9999)) rn
  FROM student_effective e WHERE e.latitude IS NOT NULL),
neigh AS (
  SELECT o.bus_id, o.sr_no, o.g,
         COALESCE(LAG(o.g) OVER (PARTITION BY o.bus_id ORDER BY o.rn),
                  (SELECT dep.geom::geography FROM buses dep WHERE dep.bus_id=o.bus_id)) prevg,
         COALESCE(LEAD(o.g) OVER (PARTITION BY o.bus_id ORDER BY o.rn), (SELECT g FROM sch)) nextg
  FROM ord o),
-- source saving: distance removed when a mover leaves its route
src_save AS (
  SELECT m.from_bus bus_id, count(*)::int moved,
         COALESCE(sum( (ST_Distance(n.prevg,n.g)+ST_Distance(n.g,n.nextg)-ST_Distance(n.prevg,n.nextg))/1000 ),0) km_saved
  FROM movers m JOIN neigh n ON n.sr_no=m.sr_no
  GROUP BY m.from_bus),
-- target add: best-insertion detour of each mover into the target route
tgt_seq AS (
  SELECT COALESCE(e.pickup_order,9999) ord, ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)::geography g
  FROM student_effective e WHERE e.bus_id=p_to AND e.latitude IS NOT NULL
  UNION ALL SELECT 2000000, (SELECT g FROM sch)),
tgt_ord AS (SELECT g, row_number() OVER (ORDER BY ord) rn FROM tgt_seq),
tgt_pairs AS (SELECT g a, LEAD(g) OVER (ORDER BY rn) b FROM tgt_ord),
tgt_add AS (
  SELECT COALESCE(sum(bestins),0) km_added FROM (
    SELECT (SELECT MIN(ST_Distance(p.a,m.g)+ST_Distance(m.g,p.b)-ST_Distance(p.a,p.b))/1000
            FROM tgt_pairs p WHERE p.b IS NOT NULL) bestins
    FROM movers m) x),
fuel AS (SELECT (SELECT tp FROM prm)*(SELECT wd FROM prm)*(SELECT dp FROM prm) AS f)
-- TARGET row
SELECT 'target' role, p_to bus_id, (SELECT count(*)::int FROM movers),
  c.riders, c.riders+(SELECT count(*) FROM movers),
  c.effective_capacity, (c.riders+(SELECT count(*) FROM movers) > c.effective_capacity),
  round((SELECT km_added FROM tgt_add)::numeric,2),
  round(((SELECT km_added FROM tgt_add)/NULLIF(bu.mileage,0)*(SELECT f FROM fuel))::numeric,0)
FROM bus_capacity c JOIN buses bu ON bu.bus_id=c.bus_id WHERE c.bus_id=p_to
UNION ALL
-- SOURCE rows
SELECT 'source', s.bus_id, s.moved, c.riders, c.riders-s.moved,
  c.effective_capacity, false,
  round((-s.km_saved)::numeric,2),
  round((-s.km_saved/NULLIF(bu.mileage,0)*(SELECT f FROM fuel))::numeric,0)
FROM src_save s JOIN bus_capacity c ON c.bus_id=s.bus_id JOIN buses bu ON bu.bus_id=s.bus_id
WHERE s.bus_id <> p_to
ORDER BY 1;
$$;


ALTER FUNCTION public.move_students_impact(p_srs text[], p_to integer) OWNER TO postgres;

--
-- TOC entry 1884 (class 1255 OID 25661)
-- Name: nearest_buses_to_point(double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer DEFAULT 3) RETURNS TABLE(bus_id integer, km double precision, riders bigint, capacity integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH cl AS (
    SELECT e.bus_id,
           ST_Centroid(ST_Collect(ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)))::geography c,
           count(*) riders
    FROM student_effective e WHERE e.latitude IS NOT NULL GROUP BY e.bus_id)
  SELECT cl.bus_id,
         round((ST_Distance(cl.c, ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography)/1000)::numeric,2)::double precision,
         cl.riders, b.capacity
  FROM cl JOIN buses b ON b.bus_id=cl.bus_id ORDER BY 2 LIMIT p_n;
$$;


ALTER FUNCTION public.nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer) OWNER TO postgres;

--
-- TOC entry 1881 (class 1255 OID 25656)
-- Name: revert_change(bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.revert_change(p_history_id bigint) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE h record;
BEGIN
  SELECT * INTO h FROM student_address_history WHERE id=p_history_id;
  IF NOT FOUND THEN RETURN 'change not found'; END IF;
  UPDATE students SET
    latitude=h.old_latitude, longitude=h.old_longitude,
    bus_no=h.old_bus_no, pickup_order=h.old_pickup_order,
    address_note='(reverted change #'||p_history_id||')'
  WHERE id=h.student_id;
  RETURN 'reverted';
END $$;


ALTER FUNCTION public.revert_change(p_history_id bigint) OWNER TO postgres;

--
-- TOC entry 530 (class 1255 OID 17597)
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION public.rls_auto_enable() OWNER TO postgres;

--
-- TOC entry 1880 (class 1255 OID 20216)
-- Name: route_km_from(integer, public.geography); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.route_km_from(p_bus integer, p_start public.geography) RETURNS double precision
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  school geography; cur geography; pts geography[];
  total double precision := 0; best_d double precision;
  i int; best_i int; n int;
BEGIN
  SELECT geom INTO school FROM schools LIMIT 1;
  SELECT array_agg(ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography)
    INTO pts FROM student_effective WHERE bus_id = p_bus AND latitude IS NOT NULL;
  IF pts IS NULL THEN RETURN NULL; END IF;
  cur := COALESCE(p_start, school);
  WHILE pts IS NOT NULL AND array_length(pts,1) > 0 LOOP
    best_d := NULL; n := array_length(pts,1);
    FOR i IN 1..n LOOP
      IF best_d IS NULL OR ST_Distance(cur, pts[i]) < best_d THEN
        best_d := ST_Distance(cur, pts[i]); best_i := i;
      END IF;
    END LOOP;
    total := total + best_d; cur := pts[best_i];
    pts := pts[1:best_i-1] || pts[best_i+1:n];
  END LOOP;
  RETURN (total + ST_Distance(cur, school)) / 1000.0;
END $$;


ALTER FUNCTION public.route_km_from(p_bus integer, p_start public.geography) OWNER TO postgres;

--
-- TOC entry 1879 (class 1255 OID 20215)
-- Name: route_km_greedy(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.route_km_greedy(p_bus integer) RETURNS double precision
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  school geography; cur geography; pts geography[];
  total double precision := 0; best_d double precision;
  i int; best_i int; n int;
BEGIN
  SELECT geom INTO school FROM schools LIMIT 1;
  SELECT array_agg(ST_SetSRID(ST_MakePoint(longitude, latitude),4326)::geography)
    INTO pts FROM student_effective
   WHERE bus_id = p_bus AND latitude IS NOT NULL;
  IF pts IS NULL THEN RETURN NULL; END IF;

  SELECT b.geom INTO cur FROM buses b WHERE b.bus_id = p_bus;
  IF cur IS NULL THEN
    -- school-start: farthest student is the first pickup
    cur := school;
    best_d := -1;
    FOR i IN 1..array_length(pts,1) LOOP
      IF ST_Distance(school, pts[i]) > best_d THEN
        best_d := ST_Distance(school, pts[i]); best_i := i;
      END IF;
    END LOOP;
    total := total + best_d;
    cur := pts[best_i];
    pts := pts[1:best_i-1] || pts[best_i+1:array_length(pts,1)];
  END IF;

  WHILE pts IS NOT NULL AND array_length(pts,1) > 0 LOOP
    best_d := NULL;
    n := array_length(pts,1);
    FOR i IN 1..n LOOP
      IF best_d IS NULL OR ST_Distance(cur, pts[i]) < best_d THEN
        best_d := ST_Distance(cur, pts[i]); best_i := i;
      END IF;
    END LOOP;
    total := total + best_d;
    cur := pts[best_i];
    pts := pts[1:best_i-1] || pts[best_i+1:n];
  END LOOP;

  RETURN (total + ST_Distance(cur, school)) / 1000.0;
END $$;


ALTER FUNCTION public.route_km_greedy(p_bus integer) OWNER TO postgres;

--
-- TOC entry 1889 (class 1255 OID 25764)
-- Name: route_overlap(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.route_overlap(p_metres integer DEFAULT 300) RETURNS TABLE(bus_a integer, bus_b integer, a_km numeric, shared_km numeric, shared_pct numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
WITH lines AS (
  SELECT e.bus_id,
    ST_MakeLine(ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326) ORDER BY COALESCE(e.pickup_order,9999)) AS ln
  FROM student_effective e WHERE e.latitude IS NOT NULL
  GROUP BY e.bus_id HAVING count(*)>=2),
pairs AS (
  SELECT a.bus_id ba, b.bus_id bb, a.ln la, b.ln lb,
         ST_Length(a.ln::geography)/1000 a_km
  FROM lines a JOIN lines b ON a.bus_id<>b.bus_id
  WHERE ST_DWithin(a.ln::geography, b.ln::geography, p_metres))
SELECT ba, bb,
  round(a_km::numeric,1) a_km,
  round((ST_Length(ST_Intersection(
     la, ST_Buffer(lb::geography, p_metres)::geometry)::geography)/1000)::numeric,1) shared_km,
  round((100*ST_Length(ST_Intersection(
     la, ST_Buffer(lb::geography, p_metres)::geometry)::geography)/NULLIF(ST_Length(la::geography),0))::numeric,0) shared_pct
FROM pairs
WHERE ST_Length(ST_Intersection(la, ST_Buffer(lb::geography,p_metres)::geometry)::geography)/1000 > 0.5
ORDER BY shared_pct DESC, shared_km DESC
LIMIT 40;
$$;


ALTER FUNCTION public.route_overlap(p_metres integer) OWNER TO postgres;

--
-- TOC entry 1690 (class 1255 OID 19499)
-- Name: students_log_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.students_log_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF (OLD.latitude IS DISTINCT FROM NEW.latitude)
     OR (OLD.longitude IS DISTINCT FROM NEW.longitude)
     OR (OLD.bus_no IS DISTINCT FROM NEW.bus_no)
     OR (OLD.pickup_order IS DISTINCT FROM NEW.pickup_order) THEN
    INSERT INTO student_address_history(
      student_id, sr_no, old_latitude, old_longitude, new_latitude, new_longitude,
      old_bus_no, new_bus_no, old_pickup_order, new_pickup_order, changed_by, note)
    VALUES (NEW.id, NEW.sr_no, OLD.latitude, OLD.longitude, NEW.latitude, NEW.longitude,
      OLD.bus_no, NEW.bus_no, OLD.pickup_order, NEW.pickup_order,
      COALESCE(auth.jwt() ->> 'email', current_user), NEW.address_note);
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.students_log_change() OWNER TO postgres;

--
-- TOC entry 1883 (class 1255 OID 25660)
-- Name: students_near_bus_route(integer, double precision); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.students_near_bus_route(p_bus integer, p_metres double precision DEFAULT 2000) RETURNS TABLE(sr_no text, student_name text, current_bus integer, metres_from_route double precision)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE line geography;
BEGIN
  SELECT ST_MakeLine(geom::geometry ORDER BY ord)::geography INTO line FROM (
    SELECT ST_SetSRID(ST_MakePoint(longitude,latitude),4326) AS geom, COALESCE(pickup_order,9999) AS ord
    FROM student_effective WHERE bus_id=p_bus AND latitude IS NOT NULL) q;
  IF line IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT e.sr_no, e.student_name, e.bus_id,
      round(ST_Distance(line, ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)::geography)::numeric,0)::double precision
    FROM student_effective e
    WHERE e.bus_id<>p_bus AND e.latitude IS NOT NULL
      AND ST_DWithin(line, ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326)::geography, p_metres)
    ORDER BY 4;
END $$;


ALTER FUNCTION public.students_near_bus_route(p_bus integer, p_metres double precision) OWNER TO postgres;

--
-- TOC entry 1689 (class 1255 OID 19482)
-- Name: students_sync_geom(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.students_sync_geom() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.geom := NULL;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(NEW.updated_by, auth.jwt() ->> 'email', current_user);
  RETURN NEW;
END $$;


ALTER FUNCTION public.students_sync_geom() OWNER TO postgres;

--
-- TOC entry 1886 (class 1255 OID 25674)
-- Name: suggest_bus_for_point(double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer DEFAULT 3) RETURNS TABLE(bus_id integer, walk_metres double precision, km_to_school double precision, riders bigint, effective_capacity integer, seats_left integer, has_room boolean, recommended boolean)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE pt geography := ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography; sch geography; best int;
BEGIN
  SELECT ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography INTO sch FROM schools LIMIT 1;
  SELECT sc.b INTO best FROM (
    WITH lines AS (
      SELECT e.bus_id AS b,
             ST_MakeLine(ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326) ORDER BY COALESCE(e.pickup_order,9999))::geography AS ln
      FROM student_effective e WHERE e.latitude IS NOT NULL GROUP BY e.bus_id)
    SELECT l.b, ST_Distance(l.ln,pt) w, (c.effective_capacity-c.riders) sl
    FROM lines l JOIN bus_capacity c ON c.bus_id=l.b) sc
  WHERE sc.sl>0 ORDER BY sc.w LIMIT 1;
  RETURN QUERY
    WITH lines AS (
      SELECT e.bus_id AS b,
             ST_MakeLine(ST_SetSRID(ST_MakePoint(e.longitude,e.latitude),4326) ORDER BY COALESCE(e.pickup_order,9999))::geography AS ln
      FROM student_effective e WHERE e.latitude IS NOT NULL GROUP BY e.bus_id)
    SELECT l.b,
           round(ST_Distance(l.ln,pt)::numeric,0)::double precision,
           round((ST_Distance(pt,sch)/1000)::numeric,2)::double precision,
           c.riders, c.effective_capacity, (c.effective_capacity-c.riders)::int,
           ((c.effective_capacity-c.riders)>0), (l.b=best)
    FROM lines l JOIN bus_capacity c ON c.bus_id=l.b
    ORDER BY ST_Distance(l.ln,pt) LIMIT p_n;
END $$;


ALTER FUNCTION public.suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer) OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 384 (class 1259 OID 19343)
-- Name: buses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.buses (
    bus_id integer NOT NULL,
    latitude double precision,
    longitude double precision,
    mileage double precision,
    geom public.geography(Point,4326),
    capacity integer,
    CONSTRAINT buses_capacity_sane CHECK (((capacity IS NULL) OR ((capacity >= 1) AND (capacity <= 100)))),
    CONSTRAINT buses_start_lat_range CHECK (((latitude IS NULL) OR ((latitude >= (26.5)::double precision) AND (latitude <= (29.0)::double precision)))),
    CONSTRAINT buses_start_lon_range CHECK (((longitude IS NULL) OR ((longitude >= (74.0)::double precision) AND (longitude <= (76.5)::double precision))))
);


ALTER TABLE public.buses OWNER TO postgres;

--
-- TOC entry 391 (class 1259 OID 20152)
-- Name: student_temp_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_temp_assignments (
    id bigint NOT NULL,
    student_id bigint NOT NULL,
    temp_latitude double precision,
    temp_longitude double precision,
    temp_bus_no integer,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date,
    reason text,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT temp_coords_paired CHECK (((temp_latitude IS NULL) = (temp_longitude IS NULL))),
    CONSTRAINT temp_dates_ordered CHECK (((valid_until IS NULL) OR (valid_until >= valid_from))),
    CONSTRAINT temp_has_content CHECK (((temp_latitude IS NOT NULL) OR (temp_bus_no IS NOT NULL))),
    CONSTRAINT temp_lat_range CHECK (((temp_latitude IS NULL) OR ((temp_latitude >= (26.5)::double precision) AND (temp_latitude <= (29.0)::double precision)))),
    CONSTRAINT temp_lon_range CHECK (((temp_longitude IS NULL) OR ((temp_longitude >= (74.0)::double precision) AND (temp_longitude <= (76.5)::double precision))))
);


ALTER TABLE public.student_temp_assignments OWNER TO postgres;

--
-- TOC entry 383 (class 1259 OID 19309)
-- Name: students; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.students (
    id bigint NOT NULL,
    sr_no text NOT NULL,
    name text,
    class text,
    section text,
    bus_no integer,
    latitude double precision,
    longitude double precision,
    geom public.geography(Point,4326),
    updated_at timestamp with time zone DEFAULT now(),
    updated_by text,
    address_note text,
    pickup_order integer,
    phone text,
    parent_name text,
    notes text,
    road_km_to_school double precision,
    road_min_to_school integer,
    uses_transport boolean DEFAULT true NOT NULL,
    CONSTRAINT students_coords_paired CHECK (((latitude IS NULL) = (longitude IS NULL))),
    CONSTRAINT students_lat_range CHECK (((latitude IS NULL) OR ((latitude >= (26.5)::double precision) AND (latitude <= (29.0)::double precision)))),
    CONSTRAINT students_lon_range CHECK (((longitude IS NULL) OR ((longitude >= (74.0)::double precision) AND (longitude <= (76.5)::double precision)))),
    CONSTRAINT students_pickup_positive CHECK (((pickup_order IS NULL) OR (pickup_order > 0)))
);


ALTER TABLE public.students OWNER TO postgres;

--
-- TOC entry 398 (class 1259 OID 25630)
-- Name: student_effective; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.student_effective WITH (security_invoker='on') AS
 SELECT s.id,
    s.sr_no,
    s.name AS student_name,
    s.class,
    s.section,
    COALESCE(t.temp_latitude, s.latitude) AS latitude,
    COALESCE(t.temp_longitude, s.longitude) AS longitude,
    COALESCE(t.temp_bus_no, s.bus_no) AS bus_id,
    s.bus_no AS permanent_bus,
    s.latitude AS permanent_latitude,
    s.longitude AS permanent_longitude,
    s.pickup_order,
    s.phone,
    s.parent_name,
    s.notes,
    (t.temp_latitude IS NOT NULL) AS using_temp_address,
    (t.temp_bus_no IS NOT NULL) AS using_temp_bus,
    t.valid_until AS temp_until,
    t.reason AS temp_reason,
    s.updated_at,
    s.updated_by
   FROM (public.students s
     LEFT JOIN LATERAL ( SELECT ta.id,
            ta.student_id,
            ta.temp_latitude,
            ta.temp_longitude,
            ta.temp_bus_no,
            ta.valid_from,
            ta.valid_until,
            ta.reason,
            ta.created_by,
            ta.created_at
           FROM public.student_temp_assignments ta
          WHERE ((ta.student_id = s.id) AND (CURRENT_DATE >= ta.valid_from) AND ((ta.valid_until IS NULL) OR (CURRENT_DATE <= ta.valid_until)))
          ORDER BY ta.valid_from DESC
         LIMIT 1) t ON (true));


ALTER VIEW public.student_effective OWNER TO postgres;

--
-- TOC entry 395 (class 1259 OID 20378)
-- Name: transport_params; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transport_params (
    id integer DEFAULT 1 NOT NULL,
    diesel_per_l numeric(8,2) DEFAULT 100 NOT NULL,
    working_days integer DEFAULT 200 NOT NULL,
    trips_per_day integer DEFAULT 2 NOT NULL,
    road_factor numeric(4,2) DEFAULT 1.6 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    big_bus_extra integer DEFAULT 8,
    small_bus_extra integer DEFAULT 5,
    big_bus_threshold integer DEFAULT 32,
    CONSTRAINT one_row CHECK ((id = 1))
);


ALTER TABLE public.transport_params OWNER TO postgres;

--
-- TOC entry 402 (class 1259 OID 25666)
-- Name: bus_capacity; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.bus_capacity WITH (security_invoker='on') AS
 SELECT b.bus_id,
    b.capacity,
    (b.capacity +
        CASE
            WHEN (b.capacity > p.big_bus_threshold) THEN p.big_bus_extra
            ELSE p.small_bus_extra
        END) AS effective_capacity,
        CASE
            WHEN (b.capacity > p.big_bus_threshold) THEN p.big_bus_extra
            ELSE p.small_bus_extra
        END AS allowance,
    COALESCE(r.riders, (0)::bigint) AS riders
   FROM ((public.buses b
     CROSS JOIN public.transport_params p)
     LEFT JOIN ( SELECT e.bus_id,
            count(*) AS riders
           FROM (public.student_effective e
             JOIN public.students s ON ((s.id = e.id)))
          WHERE s.uses_transport
          GROUP BY e.bus_id) r ON ((r.bus_id = b.bus_id)));


ALTER VIEW public.bus_capacity OWNER TO postgres;

--
-- TOC entry 401 (class 1259 OID 25651)
-- Name: alerts; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.alerts WITH (security_invoker='on') AS
 SELECT 'overloaded'::text AS kind,
    ('Bus '::text || bus_capacity.bus_id) AS subject,
    (((((bus_capacity.riders || ' in '::text) || bus_capacity.capacity) || ' seats (limit '::text) || bus_capacity.effective_capacity) || ')'::text) AS detail,
    (bus_capacity.riders - bus_capacity.effective_capacity) AS severity
   FROM public.bus_capacity
  WHERE (bus_capacity.riders > bus_capacity.effective_capacity)
UNION ALL
 SELECT 'temp_ending'::text AS kind,
    s.name AS subject,
    ('temp arrangement ends '::text || t.valid_until) AS detail,
    1 AS severity
   FROM (public.student_temp_assignments t
     JOIN public.students s ON ((s.id = t.student_id)))
  WHERE (t.valid_until = (CURRENT_DATE + 1))
UNION ALL
 SELECT 'missing_coords'::text AS kind,
    students.name AS subject,
    'no pickup coordinates'::text AS detail,
    1 AS severity
   FROM public.students
  WHERE (students.uses_transport AND (students.latitude IS NULL))
UNION ALL
 SELECT 'missing_pickup'::text AS kind,
    ('Bus '::text || students.bus_no) AS subject,
    (count(*) || ' students without a pickup position'::text) AS detail,
    (count(*))::integer AS severity
   FROM public.students
  WHERE (students.uses_transport AND (students.pickup_order IS NULL))
  GROUP BY students.bus_no;


ALTER VIEW public.alerts OWNER TO postgres;

--
-- TOC entry 403 (class 1259 OID 25675)
-- Name: bus_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bus_details (
    bus_id integer NOT NULL,
    driver_name text,
    driver_phone text,
    conductor_name text,
    conductor_phone text,
    vehicle_no text,
    model text,
    notes text,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.bus_details OWNER TO postgres;

--
-- TOC entry 394 (class 1259 OID 20361)
-- Name: student_fees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_fees (
    sr_no text NOT NULL,
    student_name text,
    annual_charge numeric(10,2) NOT NULL,
    academic_year text DEFAULT '2026-27'::text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fee_sane CHECK (((annual_charge >= (0)::numeric) AND (annual_charge <= (200000)::numeric)))
);


ALTER TABLE public.student_fees OWNER TO postgres;

--
-- TOC entry 399 (class 1259 OID 25640)
-- Name: bus_economics; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.bus_economics WITH (security_invoker='on') AS
 WITH p AS (
         SELECT transport_params.id,
            transport_params.diesel_per_l,
            transport_params.working_days,
            transport_params.trips_per_day,
            transport_params.road_factor,
            transport_params.updated_at
           FROM public.transport_params
          WHERE (transport_params.id = 1)
        ), km AS (
         SELECT b.bus_id,
            b.capacity,
            b.mileage,
            public.route_km_greedy(b.bus_id) AS straight_km
           FROM public.buses b
        ), roll AS (
         SELECT e.bus_id,
            count(*) AS students,
            sum(COALESCE(f.annual_charge, (0)::numeric)) AS fees_collected
           FROM (public.student_effective e
             LEFT JOIN public.student_fees f ON ((f.sr_no = e.sr_no)))
          GROUP BY e.bus_id
        )
 SELECT k.bus_id,
    r.students,
    k.capacity,
    k.mileage AS kmpl,
    round(((k.straight_km * (p.road_factor)::double precision))::numeric, 1) AS road_km_per_trip,
    round(((((((k.straight_km * (p.road_factor)::double precision) / NULLIF(k.mileage, (0)::double precision)) * (p.diesel_per_l)::double precision) * (p.trips_per_day)::double precision) * (p.working_days)::double precision))::numeric, 0) AS annual_fuel_cost,
    r.fees_collected AS annual_fees,
    round((((((((k.straight_km * (p.road_factor)::double precision) / NULLIF(k.mileage, (0)::double precision)) * (p.diesel_per_l)::double precision) * (p.trips_per_day)::double precision) * (p.working_days)::double precision) / (NULLIF(r.students, 0))::double precision))::numeric, 0) AS fuel_cost_per_student,
    round((((r.fees_collected)::double precision - (((((k.straight_km * (p.road_factor)::double precision) / NULLIF(k.mileage, (0)::double precision)) * (p.diesel_per_l)::double precision) * (p.trips_per_day)::double precision) * (p.working_days)::double precision)))::numeric, 0) AS margin_over_fuel
   FROM ((km k
     JOIN roll r ON ((r.bus_id = k.bus_id)))
     CROSS JOIN p)
  WHERE (k.straight_km IS NOT NULL);


ALTER VIEW public.bus_economics OWNER TO postgres;

--
-- TOC entry 405 (class 1259 OID 25694)
-- Name: bus_roster; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.bus_roster WITH (security_invoker='on') AS
 SELECT e.sr_no,
    e.student_name,
    e.class,
    e.section,
    e.bus_id,
    e.permanent_bus,
    e.pickup_order,
    e.latitude,
    e.longitude,
    e.using_temp_address,
    e.using_temp_bus,
    e.temp_until,
    s.road_km_to_school,
    s.road_min_to_school,
    c.capacity,
    c.effective_capacity,
    b.mileage,
    b.latitude AS depot_lat,
    b.longitude AS depot_lon,
    (b.geom IS NOT NULL) AS bus_has_depot
   FROM (((public.student_effective e
     JOIN public.students s ON ((s.id = e.id)))
     LEFT JOIN public.buses b ON ((b.bus_id = e.bus_id)))
     LEFT JOIN public.bus_capacity c ON ((c.bus_id = e.bus_id)))
  WHERE s.uses_transport;


ALTER VIEW public.bus_roster OWNER TO postgres;

--
-- TOC entry 385 (class 1259 OID 19350)
-- Name: schools; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schools (
    school_id integer NOT NULL,
    school_name text,
    latitude double precision,
    longitude double precision,
    geom public.geography(Point,4326)
);


ALTER TABLE public.schools OWNER TO postgres;

--
-- TOC entry 387 (class 1259 OID 19441)
-- Name: bus_routes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.bus_routes AS
 SELECT b.bus_id,
    b.capacity,
    b.mileage,
    COALESCE(b.geom, sc.geom) AS start_geom,
    (b.geom IS NULL) AS starts_from_school,
    sc.geom AS school_geom
   FROM (public.buses b
     CROSS JOIN public.schools sc);


ALTER VIEW public.bus_routes OWNER TO postgres;

--
-- TOC entry 400 (class 1259 OID 25646)
-- Name: dashboard_stats; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.dashboard_stats WITH (security_invoker='on') AS
 SELECT ( SELECT count(*) AS count
           FROM public.students
          WHERE students.uses_transport) AS students,
    ( SELECT count(*) AS count
           FROM public.buses) AS buses,
    ( SELECT COALESCE(sum(GREATEST((bus_capacity.capacity - bus_capacity.riders), (0)::bigint)), (0)::numeric) AS "coalesce"
           FROM public.bus_capacity) AS available_seats,
    ( SELECT count(*) AS count
           FROM (public.student_effective e
             JOIN public.students s ON ((s.id = e.id)))
          WHERE (s.uses_transport AND (e.using_temp_bus OR e.using_temp_address))) AS temporary_students,
    ( SELECT count(*) AS count
           FROM public.students
          WHERE (students.uses_transport AND (students.latitude IS NULL))) AS missing_coordinates,
    ( SELECT count(*) AS count
           FROM public.bus_capacity
          WHERE (bus_capacity.riders > bus_capacity.effective_capacity)) AS overloaded_buses,
    ( SELECT count(*) AS count
           FROM public.students
          WHERE (students.uses_transport AND (students.pickup_order IS NULL))) AS missing_pickup_order,
    ( SELECT count(*) AS count
           FROM public.students
          WHERE (NOT students.uses_transport)) AS self_transport;


ALTER VIEW public.dashboard_stats OWNER TO postgres;

--
-- TOC entry 408 (class 1259 OID 25734)
-- Name: fleet_speed; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.fleet_speed WITH (security_invoker='on') AS
 SELECT (COALESCE(((sum(road_km_to_school) / (NULLIF(sum(road_min_to_school), 0))::double precision) * (60)::double precision), (22)::double precision))::numeric AS kmph
   FROM public.students
  WHERE ((road_km_to_school IS NOT NULL) AND (road_min_to_school > 0));


ALTER VIEW public.fleet_speed OWNER TO postgres;

--
-- TOC entry 411 (class 1259 OID 25750)
-- Name: report_capacity; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_capacity WITH (security_invoker='on') AS
 SELECT bus_id,
    capacity,
    effective_capacity,
    riders,
    (effective_capacity - riders) AS spare,
    round(((100.0 * (riders)::numeric) / (NULLIF(capacity, 0))::numeric), 0) AS utilisation_pct
   FROM public.bus_capacity;


ALTER VIEW public.report_capacity OWNER TO postgres;

--
-- TOC entry 412 (class 1259 OID 25754)
-- Name: report_capacity_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_capacity_summary WITH (security_invoker='on') AS
 SELECT round(avg(riders), 1) AS avg_occupancy,
    max(riders) AS peak_occupancy,
    ( SELECT report_capacity_1.bus_id
           FROM public.report_capacity report_capacity_1
          WHERE (report_capacity_1.riders = ( SELECT max(report_capacity_2.riders) AS max
                   FROM public.report_capacity report_capacity_2))
         LIMIT 1) AS peak_bus,
    sum(GREATEST(spare, (0)::bigint)) AS total_spare_seats,
    round(((100.0 * sum(riders)) / (NULLIF(sum(capacity), 0))::numeric), 1) AS fleet_utilisation_pct,
    count(*) FILTER (WHERE (riders > effective_capacity)) AS over_capacity_buses,
    count(*) FILTER (WHERE (utilisation_pct < (50)::numeric)) AS under_half_buses
   FROM public.report_capacity;


ALTER VIEW public.report_capacity_summary OWNER TO postgres;

--
-- TOC entry 417 (class 1259 OID 25799)
-- Name: report_deadrun; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_deadrun WITH (security_invoker='on') AS
 WITH p AS (
         SELECT transport_params.road_factor AS rf
           FROM public.transport_params
         LIMIT 1
        ), sch AS (
         SELECT public.st_setsrid(public.st_makepoint(schools.longitude, schools.latitude), 4326) AS g
           FROM public.schools
         LIMIT 1
        ), first_stu AS (
         SELECT DISTINCT ON (students.bus_no) students.bus_no,
            students.latitude AS lat,
            students.longitude AS lon,
            students.name,
            students.sr_no
           FROM public.students
          WHERE ((students.pickup_order IS NOT NULL) AND (students.latitude IS NOT NULL))
          ORDER BY students.bus_no, students.pickup_order
        )
 SELECT b.bus_id,
    b.mileage,
        CASE
            WHEN (b.geom IS NOT NULL) THEN 'depot'::text
            ELSE 'school'::text
        END AS start_from,
    round((((public.st_distance(COALESCE(b.geom, (( SELECT sch.g
           FROM sch))::public.geography), (public.st_setsrid(public.st_makepoint(f.lon, f.lat), 4326))::public.geography) / (1000)::double precision) * (( SELECT p.rf
           FROM p))::double precision))::numeric, 2) AS dead_km,
    f.sr_no AS first_student_sr,
    f.name AS first_student
   FROM (public.buses b
     JOIN first_stu f ON ((f.bus_no = b.bus_id)));


ALTER VIEW public.report_deadrun OWNER TO postgres;

--
-- TOC entry 418 (class 1259 OID 25804)
-- Name: report_deadrun_full; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_deadrun_full WITH (security_invoker='on') AS
 SELECT bus_id,
    mileage,
    start_from,
    dead_km,
    first_student_sr,
    first_student,
    round(((((((dead_km * (( SELECT transport_params.trips_per_day
           FROM public.transport_params))::numeric) * (( SELECT transport_params.working_days
           FROM public.transport_params))::numeric))::double precision / NULLIF(mileage, (0)::double precision)) * (( SELECT transport_params.diesel_per_l
           FROM public.transport_params))::double precision))::numeric, 0) AS annual_dead_fuel,
    round(((dead_km / ( SELECT fleet_speed.kmph
           FROM public.fleet_speed)) * (60)::numeric), 1) AS dead_min_per_trip,
    GREATEST((dead_km - 1.5), (0)::numeric) AS savable_km,
    round(((((((GREATEST((dead_km - 1.5), (0)::numeric) * (( SELECT transport_params.trips_per_day
           FROM public.transport_params))::numeric) * (( SELECT transport_params.working_days
           FROM public.transport_params))::numeric))::double precision / NULLIF(mileage, (0)::double precision)) * (( SELECT transport_params.diesel_per_l
           FROM public.transport_params))::double precision))::numeric, 0) AS annual_savings_if_close
   FROM public.report_deadrun d;


ALTER VIEW public.report_deadrun_full OWNER TO postgres;

--
-- TOC entry 419 (class 1259 OID 25809)
-- Name: report_deadrun_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_deadrun_summary WITH (security_invoker='on') AS
 SELECT count(*) AS buses_measured,
    count(*) FILTER (WHERE (start_from = 'school'::text)) AS buses_from_school,
    count(*) FILTER (WHERE (dead_km > (2)::numeric)) AS buses_far,
    round(sum(dead_km), 1) AS total_dead_km_per_trip,
    round(sum(annual_dead_fuel), 0) AS total_annual_dead_fuel,
    round(sum(annual_savings_if_close), 0) AS total_annual_savings_if_close,
    round(avg(dead_km), 2) AS avg_dead_km
   FROM public.report_deadrun_full;


ALTER VIEW public.report_deadrun_summary OWNER TO postgres;

--
-- TOC entry 413 (class 1259 OID 25759)
-- Name: report_finance; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_finance WITH (security_invoker='on') AS
 SELECT ( SELECT round(sum(student_fees.annual_charge), 0) AS round
           FROM public.student_fees) AS annual_revenue,
    ( SELECT round(sum(bus_economics.annual_fuel_cost), 0) AS round
           FROM public.bus_economics) AS annual_fuel_expense,
    (( SELECT round(sum(student_fees.annual_charge), 0) AS round
           FROM public.student_fees) - ( SELECT round(sum(bus_economics.annual_fuel_cost), 0) AS round
           FROM public.bus_economics)) AS surplus_over_fuel,
    ( SELECT count(*) AS count
           FROM public.student_fees) AS paying_students,
    ( SELECT round(avg(student_fees.annual_charge), 0) AS round
           FROM public.student_fees) AS avg_fee;


ALTER VIEW public.report_finance OWNER TO postgres;

--
-- TOC entry 409 (class 1259 OID 25740)
-- Name: report_fuel; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_fuel WITH (security_invoker='on') AS
 SELECT e.bus_id,
    b.mileage AS kmpl,
    e.students,
    round(e.road_km_per_trip, 1) AS km_per_trip,
    round(e.annual_fuel_cost, 0) AS annual_fuel,
    round((e.annual_fuel_cost / NULLIF((e.road_km_per_trip * (( SELECT (transport_params.trips_per_day * transport_params.working_days)
           FROM public.transport_params
         LIMIT 1))::numeric), (0)::numeric)), 1) AS cost_per_km,
    round((e.annual_fuel_cost / (NULLIF(e.students, 0))::numeric), 0) AS fuel_per_student
   FROM (public.bus_economics e
     JOIN public.buses b ON ((b.bus_id = e.bus_id)));


ALTER VIEW public.report_fuel OWNER TO postgres;

--
-- TOC entry 410 (class 1259 OID 25745)
-- Name: report_fuel_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.report_fuel_summary WITH (security_invoker='on') AS
 SELECT ( SELECT buses.bus_id
           FROM public.buses
          WHERE (buses.mileage = ( SELECT max(buses_1.mileage) AS max
                   FROM public.buses buses_1))
         LIMIT 1) AS best_mileage_bus,
    ( SELECT max(buses.mileage) AS max
           FROM public.buses) AS best_mileage,
    ( SELECT buses.bus_id
           FROM public.buses
          WHERE (buses.mileage = ( SELECT min(buses_1.mileage) AS min
                   FROM public.buses buses_1))
         LIMIT 1) AS worst_mileage_bus,
    ( SELECT min(buses.mileage) AS min
           FROM public.buses) AS worst_mileage,
    round(avg(cost_per_km), 1) AS avg_cost_per_km,
    round(avg(fuel_per_student), 0) AS avg_fuel_per_student,
    round(sum(annual_fuel), 0) AS total_annual_fuel
   FROM public.report_fuel;


ALTER VIEW public.report_fuel_summary OWNER TO postgres;

--
-- TOC entry 393 (class 1259 OID 20325)
-- Name: stayback_roster; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.stayback_roster WITH (security_invoker='true') AS
 SELECT ta.id AS assignment_id,
    s.id AS student_id,
    s.sr_no,
    s.name AS student_name,
    s.class,
    s.section,
    s.bus_no AS permanent_bus,
    ta.temp_bus_no AS stayback_bus,
    ta.temp_latitude,
    ta.temp_longitude,
    ta.valid_from,
    ta.valid_until,
    ta.reason,
    ta.created_by,
    ta.created_at
   FROM (public.student_temp_assignments ta
     JOIN public.students s ON ((s.id = ta.student_id)))
  WHERE ((ta.reason ~~* 'stayback%'::text) AND (ta.temp_bus_no IS NOT NULL));


ALTER VIEW public.stayback_roster OWNER TO postgres;

--
-- TOC entry 414 (class 1259 OID 25766)
-- Name: stg_coords; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_coords (
    sr_no text,
    lat double precision,
    lon double precision
);


ALTER TABLE public.stg_coords OWNER TO postgres;

--
-- TOC entry 396 (class 1259 OID 20421)
-- Name: stg_fees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_fees (
    sr_no text,
    student_name text,
    annual_charge numeric
);


ALTER TABLE public.stg_fees OWNER TO postgres;

--
-- TOC entry 407 (class 1259 OID 25714)
-- Name: stg_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_profiles (
    sr_no text NOT NULL,
    student_name text,
    father_name text,
    mother_name text,
    dob date,
    father_phone text,
    mother_phone text,
    class text,
    section text,
    gender text,
    home_address text,
    admission_date date,
    previous_school text,
    updated_at timestamp with time zone
);


ALTER TABLE public.stg_profiles OWNER TO postgres;

--
-- TOC entry 404 (class 1259 OID 25689)
-- Name: stg_roadtime; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_roadtime (
    sr_no text,
    road_km double precision,
    road_min integer
);


ALTER TABLE public.stg_roadtime OWNER TO postgres;

--
-- TOC entry 415 (class 1259 OID 25771)
-- Name: stg_seat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_seat (
    sr_no text,
    ord integer,
    bus integer
);


ALTER TABLE public.stg_seat OWNER TO postgres;

--
-- TOC entry 397 (class 1259 OID 25600)
-- Name: stg_seating; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_seating (
    sr_no text,
    seat_no integer
);


ALTER TABLE public.stg_seating OWNER TO postgres;

--
-- TOC entry 416 (class 1259 OID 25776)
-- Name: stg_startpt; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_startpt (
    bus_id integer,
    lat double precision,
    lon double precision
);


ALTER TABLE public.stg_startpt OWNER TO postgres;

--
-- TOC entry 392 (class 1259 OID 20255)
-- Name: stg_students; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stg_students (
    sr_no text,
    name text,
    class text,
    section text,
    bus_no integer,
    latitude double precision,
    longitude double precision
);


ALTER TABLE public.stg_students OWNER TO postgres;

--
-- TOC entry 389 (class 1259 OID 19485)
-- Name: student_address_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_address_history (
    id bigint NOT NULL,
    student_id bigint NOT NULL,
    sr_no text,
    old_latitude double precision,
    old_longitude double precision,
    new_latitude double precision,
    new_longitude double precision,
    old_bus_no integer,
    new_bus_no integer,
    changed_by text,
    changed_at timestamp with time zone DEFAULT now(),
    note text,
    old_pickup_order integer,
    new_pickup_order integer
);


ALTER TABLE public.student_address_history OWNER TO postgres;

--
-- TOC entry 388 (class 1259 OID 19484)
-- Name: student_address_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_address_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_address_history_id_seq OWNER TO postgres;

--
-- TOC entry 5834 (class 0 OID 0)
-- Dependencies: 388
-- Name: student_address_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_address_history_id_seq OWNED BY public.student_address_history.id;


--
-- TOC entry 406 (class 1259 OID 25705)
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_profiles (
    sr_no text NOT NULL,
    student_name text,
    father_name text,
    mother_name text,
    dob date,
    father_phone text,
    mother_phone text,
    class text,
    section text,
    gender text,
    home_address text,
    admission_date date,
    previous_school text,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.student_profiles OWNER TO postgres;

--
-- TOC entry 390 (class 1259 OID 20151)
-- Name: student_temp_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_temp_assignments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_temp_assignments_id_seq OWNER TO postgres;

--
-- TOC entry 5837 (class 0 OID 0)
-- Dependencies: 390
-- Name: student_temp_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_temp_assignments_id_seq OWNED BY public.student_temp_assignments.id;


--
-- TOC entry 382 (class 1259 OID 19308)
-- Name: students_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.students_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.students_id_seq OWNER TO postgres;

--
-- TOC entry 5839 (class 0 OID 0)
-- Dependencies: 382
-- Name: students_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.students_id_seq OWNED BY public.students.id;


--
-- TOC entry 5507 (class 2604 OID 19488)
-- Name: student_address_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_address_history ALTER COLUMN id SET DEFAULT nextval('public.student_address_history_id_seq'::regclass);


--
-- TOC entry 5509 (class 2604 OID 20155)
-- Name: student_temp_assignments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_temp_assignments ALTER COLUMN id SET DEFAULT nextval('public.student_temp_assignments_id_seq'::regclass);


--
-- TOC entry 5504 (class 2604 OID 19312)
-- Name: students id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students ALTER COLUMN id SET DEFAULT nextval('public.students_id_seq'::regclass);


--
-- TOC entry 5568 (class 2606 OID 25682)
-- Name: bus_details bus_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bus_details
    ADD CONSTRAINT bus_details_pkey PRIMARY KEY (bus_id);


--
-- TOC entry 5552 (class 2606 OID 19349)
-- Name: buses buses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.buses
    ADD CONSTRAINT buses_pkey PRIMARY KEY (bus_id);


--
-- TOC entry 5554 (class 2606 OID 19356)
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (school_id);


--
-- TOC entry 5556 (class 2606 OID 19493)
-- Name: student_address_history student_address_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_address_history
    ADD CONSTRAINT student_address_history_pkey PRIMARY KEY (id);


--
-- TOC entry 5564 (class 2606 OID 20370)
-- Name: student_fees student_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_fees
    ADD CONSTRAINT student_fees_pkey PRIMARY KEY (sr_no);


--
-- TOC entry 5570 (class 2606 OID 25712)
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (sr_no);


--
-- TOC entry 5560 (class 2606 OID 20166)
-- Name: student_temp_assignments student_temp_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_temp_assignments
    ADD CONSTRAINT student_temp_assignments_pkey PRIMARY KEY (id);


--
-- TOC entry 5544 (class 2606 OID 19316)
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- TOC entry 5546 (class 2606 OID 19416)
-- Name: students students_sr_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_sr_no_key UNIQUE (sr_no);


--
-- TOC entry 5548 (class 2606 OID 19469)
-- Name: students students_sr_no_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_sr_no_unique UNIQUE (sr_no);


--
-- TOC entry 5562 (class 2606 OID 20168)
-- Name: student_temp_assignments temp_no_overlap; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_temp_assignments
    ADD CONSTRAINT temp_no_overlap EXCLUDE USING gist (student_id WITH =, daterange(valid_from, valid_until, '[]'::text) WITH &&);


--
-- TOC entry 5566 (class 2606 OID 20389)
-- Name: transport_params transport_params_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transport_params
    ADD CONSTRAINT transport_params_pkey PRIMARY KEY (id);


--
-- TOC entry 5550 (class 1259 OID 19394)
-- Name: buses_geom_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX buses_geom_idx ON public.buses USING gist (geom);


--
-- TOC entry 5557 (class 1259 OID 20180)
-- Name: idx_temp_dates; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_temp_dates ON public.student_temp_assignments USING btree (valid_from, valid_until);


--
-- TOC entry 5558 (class 1259 OID 20179)
-- Name: idx_temp_student; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_temp_student ON public.student_temp_assignments USING btree (student_id);


--
-- TOC entry 5542 (class 1259 OID 19342)
-- Name: students_geom_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX students_geom_idx ON public.students USING gist (geom);


--
-- TOC entry 5549 (class 1259 OID 25599)
-- Name: uniq_bus_pickup_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uniq_bus_pickup_order ON public.students USING btree (bus_no, pickup_order) WHERE (pickup_order IS NOT NULL);


--
-- TOC entry 5577 (class 2620 OID 19500)
-- Name: students trg_students_log_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_students_log_change AFTER UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.students_log_change();


--
-- TOC entry 5578 (class 2620 OID 19483)
-- Name: students trg_students_sync_geom; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_students_sync_geom BEFORE INSERT OR UPDATE OF latitude, longitude ON public.students FOR EACH ROW EXECUTE FUNCTION public.students_sync_geom();


--
-- TOC entry 5576 (class 2606 OID 25683)
-- Name: bus_details bus_details_bus_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bus_details
    ADD CONSTRAINT bus_details_bus_id_fkey FOREIGN KEY (bus_id) REFERENCES public.buses(bus_id);


--
-- TOC entry 5573 (class 2606 OID 19494)
-- Name: student_address_history student_address_history_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_address_history
    ADD CONSTRAINT student_address_history_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- TOC entry 5574 (class 2606 OID 20169)
-- Name: student_temp_assignments student_temp_assignments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_temp_assignments
    ADD CONSTRAINT student_temp_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;


--
-- TOC entry 5575 (class 2606 OID 20174)
-- Name: student_temp_assignments student_temp_assignments_temp_bus_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_temp_assignments
    ADD CONSTRAINT student_temp_assignments_temp_bus_no_fkey FOREIGN KEY (temp_bus_no) REFERENCES public.buses(bus_id);


--
-- TOC entry 5571 (class 2606 OID 19476)
-- Name: students students_bus_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_bus_fk FOREIGN KEY (bus_no) REFERENCES public.buses(bus_id);


--
-- TOC entry 5572 (class 2606 OID 19436)
-- Name: students students_bus_no_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_bus_no_fkey FOREIGN KEY (bus_no) REFERENCES public.buses(bus_id);


--
-- TOC entry 5759 (class 0 OID 25675)
-- Dependencies: 403
-- Name: bus_details; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.bus_details ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5777 (class 3256 OID 25688)
-- Name: bus_details bus_details_rw; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY bus_details_rw ON public.bus_details TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5750 (class 0 OID 19343)
-- Dependencies: 384
-- Name: buses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.buses ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5778 (class 3256 OID 25713)
-- Name: student_profiles profiles_rw; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY profiles_rw ON public.student_profiles TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5751 (class 0 OID 19350)
-- Dependencies: 385
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5771 (class 3256 OID 20198)
-- Name: student_temp_assignments staff_all_temp; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_all_temp ON public.student_temp_assignments TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5768 (class 3256 OID 20195)
-- Name: students staff_insert_students; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_insert_students ON public.students FOR INSERT TO authenticated WITH CHECK (true);


--
-- TOC entry 5769 (class 3256 OID 20196)
-- Name: buses staff_read_buses; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_buses ON public.buses FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5773 (class 3256 OID 20371)
-- Name: student_fees staff_read_fees; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_fees ON public.student_fees FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5772 (class 3256 OID 20199)
-- Name: student_address_history staff_read_history; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_history ON public.student_address_history FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5775 (class 3256 OID 20390)
-- Name: transport_params staff_read_params; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_params ON public.transport_params FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5770 (class 3256 OID 20197)
-- Name: schools staff_read_schools; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_schools ON public.schools FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5766 (class 3256 OID 20193)
-- Name: students staff_read_students; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_read_students ON public.students FOR SELECT TO authenticated USING (true);


--
-- TOC entry 5767 (class 3256 OID 20194)
-- Name: students staff_update_students; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_update_students ON public.students FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5774 (class 3256 OID 20372)
-- Name: student_fees staff_write_fees; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_write_fees ON public.student_fees TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5776 (class 3256 OID 20391)
-- Name: transport_params staff_write_params; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY staff_write_params ON public.transport_params TO authenticated USING (true) WITH CHECK (true);


--
-- TOC entry 5763 (class 0 OID 25766)
-- Dependencies: 414
-- Name: stg_coords; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_coords ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5757 (class 0 OID 20421)
-- Dependencies: 396
-- Name: stg_fees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_fees ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5762 (class 0 OID 25714)
-- Dependencies: 407
-- Name: stg_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_profiles ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5760 (class 0 OID 25689)
-- Dependencies: 404
-- Name: stg_roadtime; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_roadtime ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5764 (class 0 OID 25771)
-- Dependencies: 415
-- Name: stg_seat; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_seat ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5758 (class 0 OID 25600)
-- Dependencies: 397
-- Name: stg_seating; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_seating ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5765 (class 0 OID 25776)
-- Dependencies: 416
-- Name: stg_startpt; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_startpt ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5754 (class 0 OID 20255)
-- Dependencies: 392
-- Name: stg_students; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.stg_students ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5752 (class 0 OID 19485)
-- Dependencies: 389
-- Name: student_address_history; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.student_address_history ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5755 (class 0 OID 20361)
-- Dependencies: 394
-- Name: student_fees; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.student_fees ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5761 (class 0 OID 25705)
-- Dependencies: 406
-- Name: student_profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5753 (class 0 OID 20152)
-- Dependencies: 391
-- Name: student_temp_assignments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.student_temp_assignments ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5749 (class 0 OID 19309)
-- Dependencies: 383
-- Name: students; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5756 (class 0 OID 20378)
-- Dependencies: 395
-- Name: transport_params; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.transport_params ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 5786 (class 0 OID 0)
-- Dependencies: 121
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- TOC entry 5787 (class 0 OID 0)
-- Dependencies: 1887
-- Name: FUNCTION assign_impact(p_lat double precision, p_lon double precision, p_n integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.assign_impact(p_lat double precision, p_lon double precision, p_n integer) TO anon;
GRANT ALL ON FUNCTION public.assign_impact(p_lat double precision, p_lon double precision, p_n integer) TO authenticated;
GRANT ALL ON FUNCTION public.assign_impact(p_lat double precision, p_lon double precision, p_n integer) TO service_role;


--
-- TOC entry 5788 (class 0 OID 0)
-- Dependencies: 1885
-- Name: FUNCTION duplicate_pickup_locations(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.duplicate_pickup_locations() TO anon;
GRANT ALL ON FUNCTION public.duplicate_pickup_locations() TO authenticated;
GRANT ALL ON FUNCTION public.duplicate_pickup_locations() TO service_role;


--
-- TOC entry 5789 (class 0 OID 0)
-- Dependencies: 1882
-- Name: FUNCTION move_bus(p_from integer, p_to integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.move_bus(p_from integer, p_to integer) TO anon;
GRANT ALL ON FUNCTION public.move_bus(p_from integer, p_to integer) TO authenticated;
GRANT ALL ON FUNCTION public.move_bus(p_from integer, p_to integer) TO service_role;


--
-- TOC entry 5790 (class 0 OID 0)
-- Dependencies: 1888
-- Name: FUNCTION move_students_impact(p_srs text[], p_to integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.move_students_impact(p_srs text[], p_to integer) TO anon;
GRANT ALL ON FUNCTION public.move_students_impact(p_srs text[], p_to integer) TO authenticated;
GRANT ALL ON FUNCTION public.move_students_impact(p_srs text[], p_to integer) TO service_role;


--
-- TOC entry 5791 (class 0 OID 0)
-- Dependencies: 1884
-- Name: FUNCTION nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer) TO anon;
GRANT ALL ON FUNCTION public.nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer) TO authenticated;
GRANT ALL ON FUNCTION public.nearest_buses_to_point(p_lat double precision, p_lon double precision, p_n integer) TO service_role;


--
-- TOC entry 5792 (class 0 OID 0)
-- Dependencies: 1881
-- Name: FUNCTION revert_change(p_history_id bigint); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.revert_change(p_history_id bigint) TO anon;
GRANT ALL ON FUNCTION public.revert_change(p_history_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.revert_change(p_history_id bigint) TO service_role;


--
-- TOC entry 5793 (class 0 OID 0)
-- Dependencies: 530
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- TOC entry 5794 (class 0 OID 0)
-- Dependencies: 1880
-- Name: FUNCTION route_km_from(p_bus integer, p_start public.geography); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.route_km_from(p_bus integer, p_start public.geography) TO anon;
GRANT ALL ON FUNCTION public.route_km_from(p_bus integer, p_start public.geography) TO authenticated;
GRANT ALL ON FUNCTION public.route_km_from(p_bus integer, p_start public.geography) TO service_role;


--
-- TOC entry 5795 (class 0 OID 0)
-- Dependencies: 1879
-- Name: FUNCTION route_km_greedy(p_bus integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.route_km_greedy(p_bus integer) TO anon;
GRANT ALL ON FUNCTION public.route_km_greedy(p_bus integer) TO authenticated;
GRANT ALL ON FUNCTION public.route_km_greedy(p_bus integer) TO service_role;


--
-- TOC entry 5796 (class 0 OID 0)
-- Dependencies: 1889
-- Name: FUNCTION route_overlap(p_metres integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.route_overlap(p_metres integer) TO anon;
GRANT ALL ON FUNCTION public.route_overlap(p_metres integer) TO authenticated;
GRANT ALL ON FUNCTION public.route_overlap(p_metres integer) TO service_role;


--
-- TOC entry 5797 (class 0 OID 0)
-- Dependencies: 1690
-- Name: FUNCTION students_log_change(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.students_log_change() TO anon;
GRANT ALL ON FUNCTION public.students_log_change() TO authenticated;
GRANT ALL ON FUNCTION public.students_log_change() TO service_role;


--
-- TOC entry 5798 (class 0 OID 0)
-- Dependencies: 1883
-- Name: FUNCTION students_near_bus_route(p_bus integer, p_metres double precision); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.students_near_bus_route(p_bus integer, p_metres double precision) TO anon;
GRANT ALL ON FUNCTION public.students_near_bus_route(p_bus integer, p_metres double precision) TO authenticated;
GRANT ALL ON FUNCTION public.students_near_bus_route(p_bus integer, p_metres double precision) TO service_role;


--
-- TOC entry 5799 (class 0 OID 0)
-- Dependencies: 1689
-- Name: FUNCTION students_sync_geom(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.students_sync_geom() TO anon;
GRANT ALL ON FUNCTION public.students_sync_geom() TO authenticated;
GRANT ALL ON FUNCTION public.students_sync_geom() TO service_role;


--
-- TOC entry 5800 (class 0 OID 0)
-- Dependencies: 1886
-- Name: FUNCTION suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer) TO anon;
GRANT ALL ON FUNCTION public.suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer) TO authenticated;
GRANT ALL ON FUNCTION public.suggest_bus_for_point(p_lat double precision, p_lon double precision, p_n integer) TO service_role;


--
-- TOC entry 5801 (class 0 OID 0)
-- Dependencies: 384
-- Name: TABLE buses; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.buses TO anon;
GRANT ALL ON TABLE public.buses TO authenticated;
GRANT ALL ON TABLE public.buses TO service_role;


--
-- TOC entry 5802 (class 0 OID 0)
-- Dependencies: 391
-- Name: TABLE student_temp_assignments; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.student_temp_assignments TO anon;
GRANT ALL ON TABLE public.student_temp_assignments TO authenticated;
GRANT ALL ON TABLE public.student_temp_assignments TO service_role;


--
-- TOC entry 5803 (class 0 OID 0)
-- Dependencies: 383
-- Name: TABLE students; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.students TO anon;
GRANT ALL ON TABLE public.students TO authenticated;
GRANT ALL ON TABLE public.students TO service_role;


--
-- TOC entry 5804 (class 0 OID 0)
-- Dependencies: 398
-- Name: TABLE student_effective; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.student_effective TO anon;
GRANT ALL ON TABLE public.student_effective TO authenticated;
GRANT ALL ON TABLE public.student_effective TO service_role;


--
-- TOC entry 5805 (class 0 OID 0)
-- Dependencies: 395
-- Name: TABLE transport_params; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.transport_params TO anon;
GRANT ALL ON TABLE public.transport_params TO authenticated;
GRANT ALL ON TABLE public.transport_params TO service_role;


--
-- TOC entry 5806 (class 0 OID 0)
-- Dependencies: 402
-- Name: TABLE bus_capacity; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bus_capacity TO anon;
GRANT ALL ON TABLE public.bus_capacity TO authenticated;
GRANT ALL ON TABLE public.bus_capacity TO service_role;


--
-- TOC entry 5807 (class 0 OID 0)
-- Dependencies: 401
-- Name: TABLE alerts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.alerts TO anon;
GRANT ALL ON TABLE public.alerts TO authenticated;
GRANT ALL ON TABLE public.alerts TO service_role;


--
-- TOC entry 5808 (class 0 OID 0)
-- Dependencies: 403
-- Name: TABLE bus_details; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bus_details TO anon;
GRANT ALL ON TABLE public.bus_details TO authenticated;
GRANT ALL ON TABLE public.bus_details TO service_role;


--
-- TOC entry 5809 (class 0 OID 0)
-- Dependencies: 394
-- Name: TABLE student_fees; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.student_fees TO anon;
GRANT ALL ON TABLE public.student_fees TO authenticated;
GRANT ALL ON TABLE public.student_fees TO service_role;


--
-- TOC entry 5810 (class 0 OID 0)
-- Dependencies: 399
-- Name: TABLE bus_economics; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bus_economics TO anon;
GRANT ALL ON TABLE public.bus_economics TO authenticated;
GRANT ALL ON TABLE public.bus_economics TO service_role;


--
-- TOC entry 5811 (class 0 OID 0)
-- Dependencies: 405
-- Name: TABLE bus_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bus_roster TO anon;
GRANT ALL ON TABLE public.bus_roster TO authenticated;
GRANT ALL ON TABLE public.bus_roster TO service_role;


--
-- TOC entry 5812 (class 0 OID 0)
-- Dependencies: 385
-- Name: TABLE schools; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.schools TO anon;
GRANT ALL ON TABLE public.schools TO authenticated;
GRANT ALL ON TABLE public.schools TO service_role;


--
-- TOC entry 5813 (class 0 OID 0)
-- Dependencies: 387
-- Name: TABLE bus_routes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.bus_routes TO anon;
GRANT ALL ON TABLE public.bus_routes TO authenticated;
GRANT ALL ON TABLE public.bus_routes TO service_role;


--
-- TOC entry 5814 (class 0 OID 0)
-- Dependencies: 400
-- Name: TABLE dashboard_stats; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.dashboard_stats TO anon;
GRANT ALL ON TABLE public.dashboard_stats TO authenticated;
GRANT ALL ON TABLE public.dashboard_stats TO service_role;


--
-- TOC entry 5815 (class 0 OID 0)
-- Dependencies: 408
-- Name: TABLE fleet_speed; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.fleet_speed TO anon;
GRANT ALL ON TABLE public.fleet_speed TO authenticated;
GRANT ALL ON TABLE public.fleet_speed TO service_role;


--
-- TOC entry 5816 (class 0 OID 0)
-- Dependencies: 411
-- Name: TABLE report_capacity; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_capacity TO anon;
GRANT ALL ON TABLE public.report_capacity TO authenticated;
GRANT ALL ON TABLE public.report_capacity TO service_role;


--
-- TOC entry 5817 (class 0 OID 0)
-- Dependencies: 412
-- Name: TABLE report_capacity_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_capacity_summary TO anon;
GRANT ALL ON TABLE public.report_capacity_summary TO authenticated;
GRANT ALL ON TABLE public.report_capacity_summary TO service_role;


--
-- TOC entry 5818 (class 0 OID 0)
-- Dependencies: 417
-- Name: TABLE report_deadrun; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_deadrun TO anon;
GRANT ALL ON TABLE public.report_deadrun TO authenticated;
GRANT ALL ON TABLE public.report_deadrun TO service_role;


--
-- TOC entry 5819 (class 0 OID 0)
-- Dependencies: 418
-- Name: TABLE report_deadrun_full; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_deadrun_full TO anon;
GRANT ALL ON TABLE public.report_deadrun_full TO authenticated;
GRANT ALL ON TABLE public.report_deadrun_full TO service_role;


--
-- TOC entry 5820 (class 0 OID 0)
-- Dependencies: 419
-- Name: TABLE report_deadrun_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_deadrun_summary TO anon;
GRANT ALL ON TABLE public.report_deadrun_summary TO authenticated;
GRANT ALL ON TABLE public.report_deadrun_summary TO service_role;


--
-- TOC entry 5821 (class 0 OID 0)
-- Dependencies: 413
-- Name: TABLE report_finance; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_finance TO anon;
GRANT ALL ON TABLE public.report_finance TO authenticated;
GRANT ALL ON TABLE public.report_finance TO service_role;


--
-- TOC entry 5822 (class 0 OID 0)
-- Dependencies: 409
-- Name: TABLE report_fuel; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_fuel TO anon;
GRANT ALL ON TABLE public.report_fuel TO authenticated;
GRANT ALL ON TABLE public.report_fuel TO service_role;


--
-- TOC entry 5823 (class 0 OID 0)
-- Dependencies: 410
-- Name: TABLE report_fuel_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.report_fuel_summary TO anon;
GRANT ALL ON TABLE public.report_fuel_summary TO authenticated;
GRANT ALL ON TABLE public.report_fuel_summary TO service_role;


--
-- TOC entry 5824 (class 0 OID 0)
-- Dependencies: 393
-- Name: TABLE stayback_roster; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stayback_roster TO anon;
GRANT ALL ON TABLE public.stayback_roster TO authenticated;
GRANT ALL ON TABLE public.stayback_roster TO service_role;


--
-- TOC entry 5825 (class 0 OID 0)
-- Dependencies: 414
-- Name: TABLE stg_coords; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_coords TO anon;
GRANT ALL ON TABLE public.stg_coords TO authenticated;
GRANT ALL ON TABLE public.stg_coords TO service_role;


--
-- TOC entry 5826 (class 0 OID 0)
-- Dependencies: 396
-- Name: TABLE stg_fees; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_fees TO anon;
GRANT ALL ON TABLE public.stg_fees TO authenticated;
GRANT ALL ON TABLE public.stg_fees TO service_role;


--
-- TOC entry 5827 (class 0 OID 0)
-- Dependencies: 407
-- Name: TABLE stg_profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_profiles TO anon;
GRANT ALL ON TABLE public.stg_profiles TO authenticated;
GRANT ALL ON TABLE public.stg_profiles TO service_role;


--
-- TOC entry 5828 (class 0 OID 0)
-- Dependencies: 404
-- Name: TABLE stg_roadtime; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_roadtime TO anon;
GRANT ALL ON TABLE public.stg_roadtime TO authenticated;
GRANT ALL ON TABLE public.stg_roadtime TO service_role;


--
-- TOC entry 5829 (class 0 OID 0)
-- Dependencies: 415
-- Name: TABLE stg_seat; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_seat TO anon;
GRANT ALL ON TABLE public.stg_seat TO authenticated;
GRANT ALL ON TABLE public.stg_seat TO service_role;


--
-- TOC entry 5830 (class 0 OID 0)
-- Dependencies: 397
-- Name: TABLE stg_seating; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_seating TO anon;
GRANT ALL ON TABLE public.stg_seating TO authenticated;
GRANT ALL ON TABLE public.stg_seating TO service_role;


--
-- TOC entry 5831 (class 0 OID 0)
-- Dependencies: 416
-- Name: TABLE stg_startpt; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_startpt TO anon;
GRANT ALL ON TABLE public.stg_startpt TO authenticated;
GRANT ALL ON TABLE public.stg_startpt TO service_role;


--
-- TOC entry 5832 (class 0 OID 0)
-- Dependencies: 392
-- Name: TABLE stg_students; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.stg_students TO anon;
GRANT ALL ON TABLE public.stg_students TO authenticated;
GRANT ALL ON TABLE public.stg_students TO service_role;


--
-- TOC entry 5833 (class 0 OID 0)
-- Dependencies: 389
-- Name: TABLE student_address_history; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.student_address_history TO anon;
GRANT ALL ON TABLE public.student_address_history TO authenticated;
GRANT ALL ON TABLE public.student_address_history TO service_role;


--
-- TOC entry 5835 (class 0 OID 0)
-- Dependencies: 388
-- Name: SEQUENCE student_address_history_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.student_address_history_id_seq TO anon;
GRANT ALL ON SEQUENCE public.student_address_history_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.student_address_history_id_seq TO service_role;


--
-- TOC entry 5836 (class 0 OID 0)
-- Dependencies: 406
-- Name: TABLE student_profiles; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.student_profiles TO anon;
GRANT ALL ON TABLE public.student_profiles TO authenticated;
GRANT ALL ON TABLE public.student_profiles TO service_role;


--
-- TOC entry 5838 (class 0 OID 0)
-- Dependencies: 390
-- Name: SEQUENCE student_temp_assignments_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.student_temp_assignments_id_seq TO anon;
GRANT ALL ON SEQUENCE public.student_temp_assignments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.student_temp_assignments_id_seq TO service_role;


--
-- TOC entry 5840 (class 0 OID 0)
-- Dependencies: 382
-- Name: SEQUENCE students_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.students_id_seq TO anon;
GRANT ALL ON SEQUENCE public.students_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.students_id_seq TO service_role;


--
-- TOC entry 4213 (class 826 OID 16494)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 4214 (class 826 OID 16495)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 4212 (class 826 OID 16493)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 4216 (class 826 OID 16497)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 4211 (class 826 OID 16492)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- TOC entry 4215 (class 826 OID 16496)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- Completed on 2026-08-06 13:18:56

--
-- PostgreSQL database dump complete
--

\unrestrict maEVUj4qvtOcMgBXml9qtWCFB3hHtA6ENfy0VqCBqLYFG9ZdRHhETOxXXucan5N

