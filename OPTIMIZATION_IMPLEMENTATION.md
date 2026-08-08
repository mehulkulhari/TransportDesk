# Optimization Tab Implementation Summary

## What Was Done

### 1. Frontend Changes

#### HTML (frontend/index.html)
- Added "Optimization" navigation button at position 8 (between "Bus page" and "Bulk")
- Added view section with id="v-opt" to display optimization content

#### JavaScript Module (frontend/js/optimization.js) - NEW FILE
Created a complete optimization analysis module with:
- **renderOptimization()** - Main entry point that loads all optimization data
- **loadOptimizationData()** - Fetches data from 7 snapshot tables via Supabase REST API
- **renderOptTable()** - Helper to create HTML tables from analysis data
- **downloadOptCsv()** - Allows users to download analysis tables as CSV
- **fillFromWrongBusList()** - Pre-fills simulator with students needing reassignment
- **simulateChanges()** - Calls the RPC function to test what-if scenarios
- **statCard()** - Helper to render key metric cards

#### App Integration (frontend/js/app.js)
- Added import for "./optimization.js"
- Added navigation handler: `if(v==='opt')renderOptimization();`

### 2. Database Verification

Confirmed all required components exist:

**Snapshot Tables** (precomputed data, updated by refresh_optimization):
- opt_master (1 row) - Summary metrics for 6 headline cards
- opt_misassigned (12 rows) - Students on wrong buses
- opt_route_split (28 rows) - Stretched routes needing consolidation
- opt_backtrackers (165 rows) - Students bus drives away from school to reach
- opt_merge (38 rows) - Bus pairs that could consolidate

**Support Tables**:
- opt_meta (1 row) - Stores refreshed_at timestamp
- report_fuel_summary (1 row) - Annual fuel expense data

**RPC Functions**:
- refresh_optimization() - Recalculates all snapshots from current data
- simulate_moves() - Tests reassignment scenarios

## Feature Overview

### Six Headline Cards
1. Wrong-bus students (12) - Annual fuel cost savings
2. Stretched routes (27 buses) - Gross annual savings if outliers move
3. Backtracker outliers (165 students) - Diagnostic count
4. Retirable buses (4) - Annual fuel savings from consolidation
5. Fleet utilisation - Current vs theoretical minimum
6. Annual fuel spend - Total from report_fuel_summary

### Four Analysis Tables
1. **Wrong-bus students** - Specific children who'd save fuel on a different bus
2. **Stretched routes** - Buses with outlier groups dragging them off-route
3. **Backtracker students** - Kids whose bus goes away from school to reach them
4. **Consolidation candidates** - Bus pairs that could merge

Each table:
- Shows top 50-100 rows
- Has sortable/formattable columns
- Includes "Download CSV" button
- Uses actual database column names

### What-If Simulator
- Enter moves as "SR BUS" (e.g., "4807 44")
- One move per line, multiple moves supported
- Returns:
  - Total annual savings across all moves
  - Average distance change per trip
  - Average fleet time change
  - Per-move detail (each child's experience)
  - Capacity warnings if bus exceeds limit
- "Fill from wrong-bus list" pre-populates with candidates

## Database Column Mappings

### opt_master
- misassigned_students → Card value
- misassign_fuel → Annual savings for wrong-bus students
- stretched_buses → Count of stretched routes
- route_split_fuel_gross → Gross savings if stretched outliers move
- backtracker_students → Count in diagnostic list
- retirable_buses → Count of consolidation targets
- merge_fuel → Annual fuel savings from merges
- buses_running → Current fleet size
- fleet_utilisation_pct → Utilization percentage

### opt_misassigned
- sr_no, student_name, own_bus, near_bus
- own_detour_m, near_insert_m → Distance metrics
- annual_fuel_saving → Savings if moved

### opt_route_split
- bus_id, outlier_students, route_km_now
- route_km_without, km_saved_per_trip
- annual_fuel_if_split → Savings potential

### opt_backtrackers
- sr_no, student_name, bus_id
- km_from_cluster, km_to_school → Distance metrics
- annual_backtrack_fuel → Cost of this student's deviation

### opt_merge
- bus_a, bus_b → Which buses could consolidate
- riders_a, riders_b, combined → Capacity impact
- potential_annual_saving → Fuel savings from merge

## Testing Checklist

- [ ] Load app at localhost:8000
- [ ] Log in with a valid Supabase account
- [ ] Click "Optimization" tab in navbar
- [ ] Verify 6 headline cards load with correct values
- [ ] Verify 4 analysis tables appear with data
- [ ] Verify each table has "Download CSV" button
- [ ] Click "Fill from wrong-bus list" → simul input populated
- [ ] Enter custom moves (e.g., "4807 44") and click Simulate
- [ ] Verify simulator returns savings, distance, time changes
- [ ] Click "Recalculate analysis" button
- [ ] Verify timestamp updates in opt_meta

## Known Limitations

1. **No real GPS routes** - All distances are straight-line × 1.6 road factor
2. **Analysis is upper bound** - Some students can be both wrong-bus and backtrackers; levers overlap
3. **No persistence** - Simulator results are not saved; you must manually update students table
4. **No multi-move validation** - Simulator doesn't detect conflicts if moving multiple students creates a new problem

## Files Modified

1. `frontend/index.html` - Added nav button and view section
2. `frontend/js/app.js` - Added import and navigation handler
3. `frontend/js/optimization.js` - NEW: Complete optimization module
4. `.claude/launch.json` - NEW: Launch configuration for local dev server

## Next Steps (Optional)

1. Add "Commit moves" button to apply simulator results to database
2. Add filtering/sorting to analysis tables
3. Add heatmap visualization of optimization opportunities
4. Add email/Slack integration for scheduled optimization reports
5. Implement live routing with actual road network (Google Maps API or OSRM)
