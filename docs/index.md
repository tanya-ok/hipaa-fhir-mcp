<p class="project-kicker">Healthcare / Synthetic data</p>

# Give agents three focused health-data tools.

<p class="project-lead">Read a synthetic patient record, observations or medications through a small, validated interface. Keep sensitive values out of audit logs.</p>

## How it works

```mermaid
---
config:
  theme: base
  themeVariables:
    fontFamily: 'Arial, sans-serif'
    fontSize: '15px'
  flowchart:
    nodeSpacing: 24
    rankSpacing: 28
    padding: 12
---
flowchart TB
    accTitle: Validated access to synthetic health records
    accDescr: The AI client invokes one of three tools. The server validates input, reads the synthetic FHIR service over HTTPS, validates the response and records a minimized audit outcome.
    A["AI client"] --> T["Three tools<br/>Patient / observations / medications"]
    T --> V["FHIR tool server<br/>Validates input and response"]
    V <-->|Verified HTTPS| F[("Synthetic FHIR records")]
    V --> L["Audit outcome<br/>No patient values"]
    classDef source fill:#e8effa,stroke:#5276a2,color:#183452,stroke-width:1.5px
    classDef core fill:#e0f3ec,stroke:#328267,color:#173f33,stroke-width:1.5px
    classDef limit fill:#fff0dc,stroke:#b27b36,color:#63421d,stroke-width:1.5px
    class A,F source
    class T,V core
    class L limit
```

[Run the demo](demo.md){ .overview-link }
[Identity-enabled lab](kubernetes-lab.md){ .overview-link }
[Implemented controls and gaps](hipaa-compliance-mapping.md){ .overview-link }

!!! note "Scope"
    Synthetic data only. The demo does not establish clinical consent, SMART authorization or HIPAA compliance.
