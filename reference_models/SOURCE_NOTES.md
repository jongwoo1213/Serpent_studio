# Downloaded Serpent reference models

Downloaded on 2026-07-29 for local SERPENT Studio compatibility testing.

## 1. MSRE-MartinRA — MSRE full-core input

- Source: https://github.com/ondrejch/MSRE-MartinRA
- Commit: `5e3b1e426a75e8083f1afadb268dddba11e2c378`
- License: MIT (`MSRE-MartinRA/LICENSE`)
- Reactor: Molten Salt Reactor Experiment (MSRE), full-core Serpent model
- Ready-to-open monolithic inputs:
  - `MSRE-MartinRA/runs/900K-8MWth/msre`
  - `MSRE-MartinRA/runs/900K-per_n/msre`

The repository does not contain generated `*_res.m` files. Its scripts expect
Serpent to generate temperature-dependent result files locally. Running the
model also requires a licensed Serpent installation and compatible nuclear-data
libraries.

For the current GUI, `runs/900K-8MWth/msre` is the best full-core MSRE input
fixture because all surfaces, cells, materials, and run cards are expanded into
one file instead of being split across `include` files.

## GUI-ready copies

The source files are preserved unchanged. Convenience copies with recognizable
extensions are available in `gui_ready/`:

- `MSRE_900K_8MWth_full_core.serp`
- `MSRE_900K_per_neutron_full_core.serp`
- `MSR_3D_full_core_res.m`
- `MSDR_3D_full_core_res.m`
- `MSRE_2D_pin_res.m`

The first two are genuine MSRE full-core inputs but have no matching public
result file. The two 3D result files are from other molten-salt reactor models.
The final file is MSRE-specific but represents a pin cell rather than the whole
core.

## 2. SERPENT-MSR-3D — input/result compatibility fixtures

- Source: https://github.com/pedrojrv/SERPENT
- Commit: `5df6a55f1601521a02db53554bec244377637598`
- License: no license file or SPDX license was declared by the source repository;
  keep this copy for local inspection/testing unless permission is obtained.

Downloaded subsets:

- `5_3DReactor/FinalMSR/MSR_Optimized/`
  - 3D molten-salt reactor tutorial model
  - main input: `MSRreactor`
  - result: `MSRreactor_res.m`
  - detector, geometry, mesh, and analysis outputs are included
- `MSDR_Serpent/3D_Core/`
  - modified Molten Salt Demonstration Reactor full-core model
  - main assembled card: `MSDRcore`
  - result: `MSRreactor_res.m`
  - detector, geometry, mesh, and analysis outputs are included
- `MSRE_Serpent/2D_Pin/`
  - MSRE pin-cell model, not a full-core model
  - input/result pairs and flux/mesh images are included
  - retained as an MSRE-specific spectrum/result parser fixture

The included result files report `SIMULATION_COMPLETED = 1` and
`LOST_PARTICLES = 0`. They were generated with Serpent 2.1.31, but use small
Monte Carlo populations and are strongly supercritical. They are suitable for
format/parser and visualization tests, not as validated benchmark answers.

Before rerunning any model, replace hard-coded `set acelib`, `set declib`, and
`set nfylib` paths with the paths to locally installed compatible libraries.
