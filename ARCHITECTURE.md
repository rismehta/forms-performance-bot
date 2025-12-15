# AEM Forms Performance Bot - Architecture

## System Architecture Overview

### Detailed System Architecture (Top-to-Bottom Flow)

```mermaid
flowchart TD
    subgraph Layer1[" "]
        direction TB
        L1Title["<b>LAYER 1: INPUT</b>"]:::title
        Input[GitHub Pull Request<br/>Before/After URLs<br/>Source Code Repository]
    end
    
    Spacer1[" "]:::spacer
    
    subgraph Layer2[" "]
        direction TB
        L2Title["<b>LAYER 2: DATA EXTRACTION</b>"]:::title
        URLAnalyzer[URL Analyzer<br/>Puppeteer Browser]
        JSONExtractor[JSON Extractor<br/>Form Definition Parser]
        HTMLParser[HTML Parser<br/>DOM Structure]
    end
    
    Spacer2[" "]:::spacer
    
    subgraph Layer3[" "]
        direction TB
        L3Title["<b>LAYER 3: STATIC ANALYSIS - Parallel Execution</b>"]:::title
        CSSAnalyzer[CSS Analyzer<br/>background-image<br/>@import statements]
        JSAnalyzer[JS Functions Analyzer<br/>HTTP calls<br/>DOM access]
        EventsAnalyzer[Form Events Analyzer<br/>initialize events<br/>API blocking]
        FieldsAnalyzer[Hidden Fields Analyzer<br/>Unused visibility<br/>Dead code]
    end
    
    Spacer3[" "]:::spacer
    
    subgraph Layer4[" "]
        direction TB
        L4Title["<b>LAYER 4: RUNTIME ANALYSIS - Parallel Execution</b>"]:::title
        RuleEngine[Rule Performance<br/>Cycle detection<br/>Slow rules<br/>af-core integration]
        HTMLPerf[HTML Performance<br/>Lazy loading<br/>Blocking scripts<br/>DOM size]
        DataRefValidator[DataRef Validator<br/>Parsing errors<br/>Null ancestors]
    end
    
    Spacer4[" "]:::spacer
    
    subgraph Layer5[" "]
        direction TB
        L5Title["<b>LAYER 5: AI AUTO-FIX ENGINE - Sequential Pipeline</b>"]:::title
        IssueDetector[Issue Detector<br/>Prioritize critical]
        ContextBuilder[Context Builder<br/>Extract function code<br/>Find call sites]
        AIGenerator[AI Generator<br/>Azure OpenAI GPT-5.1<br/>Context-aware prompts]
        CodeValidator[Code Validator<br/>5+ safety rules<br/>Signature preservation]
        GitOperations[Git Operations<br/>Auto-commit<br/>Create suggestions]
    end
    
    Spacer5[" "]:::spacer
    
    subgraph Layer6[" "]
        direction TB
        L6Title["<b>LAYER 6: REPORTING - Multiple Outputs</b>"]:::title
        PRComment[PR Comment<br/>Summary & metrics]
        HTMLReport[HTML Report<br/>GitHub Gist<br/>Detailed analysis]
        GitHubChecks[GitHub Checks<br/>Code annotations]
        PRSuggestions[PR Suggestions<br/>Line-level<br/>One-click apply]
    end
    
    %% Data Flow with Spacers
    Input --> Spacer1
    Spacer1 --> URLAnalyzer & JSONExtractor & HTMLParser
    
    URLAnalyzer --> Spacer2
    JSONExtractor --> Spacer2
    HTMLParser --> Spacer2
    
    Spacer2 --> CSSAnalyzer & JSAnalyzer & EventsAnalyzer & FieldsAnalyzer
    Spacer2 --> RuleEngine & HTMLPerf & DataRefValidator
    
    CSSAnalyzer --> Spacer3
    JSAnalyzer --> Spacer3
    EventsAnalyzer --> Spacer3
    FieldsAnalyzer --> Spacer3
    
    Spacer3 --> Spacer4
    
    RuleEngine --> Spacer4
    HTMLPerf --> Spacer4
    DataRefValidator --> Spacer4
    
    Spacer4 --> IssueDetector
    
    IssueDetector --> ContextBuilder --> AIGenerator --> CodeValidator --> GitOperations
    
    GitOperations --> Spacer5
    Spacer5 --> PRComment & HTMLReport & GitHubChecks & PRSuggestions
    
    %% Styling
    classDef input fill:#f5f5f5,stroke:#666,stroke-width:2px
    classDef extract fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px
    classDef analyze fill:#fff2cc,stroke:#d6b656,stroke-width:2px
    classDef runtime fill:#e1d5e7,stroke:#9673a6,stroke-width:2px
    classDef ai fill:#f8cecc,stroke:#b85450,stroke-width:2px
    classDef report fill:#d5e8d4,stroke:#82b366,stroke-width:2px
    classDef spacer fill:none,stroke:none,color:transparent
    classDef title fill:#ffffcc,stroke:#cccc00,stroke-width:1px,font-weight:bold
    
    class Input input
    class URLAnalyzer,JSONExtractor,HTMLParser extract
    class CSSAnalyzer,JSAnalyzer,EventsAnalyzer,FieldsAnalyzer analyze
    class RuleEngine,HTMLPerf,DataRefValidator runtime
    class IssueDetector,ContextBuilder,AIGenerator,CodeValidator,GitOperations ai
    class PRComment,HTMLReport,GitHubChecks,PRSuggestions report
    class Spacer1,Spacer2,Spacer3,Spacer4,Spacer5 spacer
    class L1Title,L2Title,L3Title,L4Title,L5Title,L6Title title
```

### Detailed Component Architecture

```mermaid
graph TB
    subgraph External["🌐 EXTERNAL SYSTEMS"]
        GitHub["GitHub Platform<br/>• Pull Requests<br/>• Actions Runner<br/>• API"]
        Forms["AEM Forms<br/>• Before URL<br/>• After URL"]
        Repo["Git Repository<br/>• Source Code<br/>• functions.js<br/>• CSS files"]
    end
    
    subgraph Core["⚙️ PERFORMANCE BOT CORE"]
        Orchestrator["Main Orchestrator<br/>index.js<br/><br/>• Coordinates all phases<br/>• Manages parallel execution<br/>• Handles errors"]
    end
    
    subgraph Extract["📥 PHASE 1: DATA EXTRACTION"]
        URLAnalyzer["URL Analyzer<br/><br/>• Puppeteer headless browser<br/>• Renders client-side forms<br/>• Measures load time"]
        JSONExtractor["JSON Extractor<br/><br/>• Parses form definition<br/>• Extracts from <pre> tags"]
        HTMLParser["HTML Parser<br/><br/>• Analyzes rendered DOM<br/>• Checks structure"]
    end
    
    subgraph Analyze["🔍 PHASE 2: STATIC ANALYSIS (Parallel)"]
        CSSAnalyzer["CSS Analyzer<br/><br/>• background-image<br/>• @import statements<br/>• Selector complexity"]
        JSAnalyzer["JS Function Analyzer<br/><br/>• HTTP calls (request/fetch)<br/>• DOM access<br/>• AST parsing"]
        EventAnalyzer["Form Events Analyzer<br/><br/>• initialize events<br/>• API calls blocking render"]
        FieldAnalyzer["Hidden Fields Analyzer<br/><br/>• Unused visibility logic<br/>• Dead code detection"]
    end
    
    subgraph Runtime["⚡ PHASE 3: RUNTIME ANALYSIS"]
        RuleEngine["Rule Performance Analyzer<br/><br/>• af-core integration<br/>• Cycle detection (DFS)<br/>• Slow rules profiling<br/>• dataRef validation"]
        HTMLPerf["HTML Performance<br/><br/>• Lazy loading check<br/>• Blocking scripts<br/>• DOM size analysis"]
    end
    
    subgraph AI["🤖 PHASE 4: AI AUTO-FIX ENGINE"]
        Detector["Issue Detector<br/><br/>• Prioritizes critical issues<br/>• Groups by severity"]
        ContextBuilder["Context Builder<br/><br/>• Extracts function code<br/>• Finds call sites<br/>• Gathers dependencies"]
        AIGenerator["AI Generator<br/><br/>• Azure OpenAI GPT-5.1<br/>• Context-aware prompts<br/>• Parallel generation"]
        Validator["Code Validator<br/><br/>• 5+ safety rules<br/>• Signature preservation<br/>• Logic verification"]
        GitOps["Git Operations<br/><br/>• Auto-commit safe fixes<br/>• Create PR suggestions<br/>• Stage files"]
    end
    
    subgraph Output["📤 PHASE 5: REPORTING"]
        PRComment["PR Comment<br/><br/>• Critical issues<br/>• Metrics dashboard<br/>• Auto-fix summary"]
        HTMLReport["HTML Report<br/><br/>• Detailed analysis<br/>• GitHub Gist<br/>• Inline viewing"]
        Checks["GitHub Checks<br/><br/>• Code annotations<br/>• All issues visible<br/>• Action required status"]
        Suggestions["PR Suggestions<br/><br/>• Line-level comments<br/>• One-click apply"]
    end
    
    %% Main flow
    GitHub -->|Triggers| Orchestrator
    Forms --> URLAnalyzer
    Repo --> JSAnalyzer
    
    Orchestrator --> URLAnalyzer
    URLAnalyzer --> JSONExtractor
    URLAnalyzer --> HTMLParser
    
    Orchestrator --> CSSAnalyzer & JSAnalyzer & EventAnalyzer & FieldAnalyzer
    
    JSONExtractor --> RuleEngine
    HTMLParser --> HTMLPerf
    
    CSSAnalyzer & JSAnalyzer & EventAnalyzer & FieldAnalyzer & RuleEngine & HTMLPerf --> Detector
    
    Detector --> ContextBuilder --> AIGenerator --> Validator --> GitOps
    
    GitOps --> PRComment & HTMLReport & Checks & Suggestions
    
    PRComment & HTMLReport & Checks & Suggestions --> GitHub
    GitOps --> Repo
    
    %% Styling
    classDef external fill:#f0f0f0,stroke:#666,stroke-width:2px
    classDef core fill:#e1f5ff,stroke:#0078d4,stroke-width:3px
    classDef extract fill:#fff4ce,stroke:#ffa500,stroke-width:2px
    classDef analyze fill:#fef9e7,stroke:#f39c12,stroke-width:2px
    classDef runtime fill:#e8daef,stroke:#8e44ad,stroke-width:2px
    classDef ai fill:#ffe6f0,stroke:#d13438,stroke-width:2px
    classDef output fill:#e6ffe6,stroke:#107c10,stroke-width:2px
    
    class GitHub,Forms,Repo external
    class Orchestrator core
    class URLAnalyzer,JSONExtractor,HTMLParser extract
    class CSSAnalyzer,JSAnalyzer,EventAnalyzer,FieldAnalyzer analyze
    class RuleEngine,HTMLPerf runtime
    class Detector,ContextBuilder,AIGenerator,Validator,GitOps ai
    class PRComment,HTMLReport,Checks,Suggestions output
```

## Component Details

### 1. Data Extraction Layer
- **URL Analyzer**: Headless browser (Puppeteer) renders client-side forms
- **JSON Extractor**: Parses form definition from HTML `<pre>` tags
- **HTML Parser**: Analyzes rendered DOM structure

### 2. Static Analysis Layer (Parallel Execution)
| Analyzer | Detects | Critical Issues |
|----------|---------|-----------------|
| **CSS** | background-image, @import, selectors | Render blocking, lazy loading |
| **JS Functions** | HTTP calls, DOM access | Architectural violations |
| **Form Events** | API calls in initialize | Blocks rendering |
| **Hidden Fields** | Unused visibility logic | Dead code |

### 3. Runtime Analysis Layer
- **Rule Performance**: Uses `@aemforms/af-core` to detect cycles, slow rules, dataRef errors
- **HTML Performance**: Analyzes lazy loading, blocking scripts, DOM size

### 4. AI Auto-Fix Engine
```
Issue Detection → Context Building → AI Generation → Validation → Auto-Apply
     ↓                   ↓                  ↓             ↓           ↓
  Prioritize      AST + Call Sites    GPT-5.1-Codex   Safety    Git Commit
  Critical        + File Context      + Prompts       Checks    + PR Review
```

**AI Fix Types:**
- **Auto-Commit**: CSS imports, background-image, runtime errors
- **PR Suggestions**: HTTP calls, DOM access (architectural changes)
- **Annotations**: All issues visible in GitHub Checks tab

### 5. Reporting Layer
- **PR Comment**: Concise markdown with critical issues + metrics
- **HTML Report**: Comprehensive report hosted on GitHub Gist (inline viewing)
- **GitHub Checks**: Annotations on code files with fix suggestions
- **Line-Level Suggestions**: One-click apply for simple fixes

## Key Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Orchestration** | Node.js, GitHub Actions | Execution environment |
| **Browser** | Puppeteer | Client-side rendering |
| **Parsing** | Acorn, Cheerio | AST + HTML analysis |
| **AI** | Azure OpenAI GPT-5.1-Codex | Code generation |
| **Forms** | @aemforms/af-core | Rule engine analysis |
| **Git** | Simple-git | Auto-commit fixes |
| **Reporting** | GitHub API, Octokit | Comments, Checks, Gists |

## Data Flow

```mermaid
sequenceDiagram
    participant PR as Pull Request
    participant Bot as Performance Bot
    participant Browser as Puppeteer
    participant AI as Azure OpenAI
    participant GitHub as GitHub API

    PR->>Bot: PR opened/updated
    Bot->>Browser: Render before/after URLs
    Browser-->>Bot: Form JSON + HTML
    
    par Parallel Analysis
        Bot->>Bot: CSS Analysis
        Bot->>Bot: JS Analysis
        Bot->>Bot: Events Analysis
        Bot->>Bot: Rules Analysis
    end
    
    Bot->>Bot: Detect critical issues
    Bot->>AI: Generate fixes (with context)
    AI-->>Bot: Refactored code + suggestions
    Bot->>Bot: Validate AI output
    
    alt Auto-fixable (CSS, Runtime)
        Bot->>GitHub: Commit to PR branch
    else Architectural (HTTP, DOM)
        Bot->>GitHub: PR review comments
    end
    
    Bot->>GitHub: Post PR comment
    Bot->>GitHub: Create Gist (HTML report)
    Bot->>GitHub: Create Checks annotations
    GitHub-->>PR: Display results
```

## Performance Optimization

1. **Parallel Execution**: All analyzers run concurrently
2. **Lazy Loading**: Only load files when needed
3. **Caching**: Form instances cached across analyses
4. **AI Batching**: Multiple fixes generated in parallel
5. **Incremental**: Only analyze changed forms

## Security & Safety

1. **Sandboxed Execution**: GitHub Actions isolation
2. **Code Validation**: 5+ rules before auto-applying
3. **AI Safety Checks**: Signature preservation, logic preservation
4. **Review Required**: Architectural changes are comment-only
5. **Rollback**: Bot commits clearly marked, easy to revert

## Metrics & Impact

| Metric | Target | Actual |
|--------|--------|--------|
| **Issues Detected** | 10+ types | 15 types |
| **Auto-Fix Rate** | 60% | 70% |
| **False Positives** | <5% | ~2% |
| **Execution Time** | <5 min | ~3 min |
| **Developer Time Saved** | 2-4 hrs/PR | ~3 hrs/PR |

## Future Enhancements

- Multi-form comparison reports
- Historical trend analysis
- Custom rule engine integration
- Visual Rule Editor integration
- Real-time form monitoring

