# **Peter’s Photo Manager**

## **Project Summary**

Peter’s Photo Manager is a fast, local-first desktop application for browsing, organizing, tagging, searching, viewing, and eventually editing photographs.

The program should run on both macOS and Windows. It should work directly with the user’s existing folder structure rather than requiring photographs to be imported into a proprietary library.

The long-term goal is to create a modern desktop photo manager with:

- fast folder browsing
- thumbnail grids
- full-size image viewing
- manual tags and ratings
- albums
- drag-and-drop organization
- exporting
- non-destructive editing
- local AI-assisted tagging and search
- face grouping
- duplicate detection
- OCR
- optional mapping

The project must be developed incrementally. Do not attempt to build the entire application at once.

Each development phase should introduce one small, testable set of features. Every phase must leave the application in a working state.

---

# **Primary Development Principle**

The most important requirement is controlled, iterative development.

The project must not attempt to implement the complete software specification during the initial build.

Development should follow these rules:

1. Build the smallest useful version first.
2. Add one feature or closely related feature group at a time.
3. Test each feature before beginning the next.
4. Avoid speculative infrastructure for distant future features.
5. Keep the application runnable after every development milestone.
6. Do not refactor unrelated parts of the application while adding a feature.
7. Do not add a dependency unless it is required by the current milestone.
8. Maintain a clear backlog of future features.
9. Separate completed, current, and future work.
10. Prefer simple working implementations over broad incomplete systems.

The first version should only prove that the application can scan a folder and display photographs quickly.

---

# **Product Name**

Display name:

Peter’s Photo Manager

Repository name:

peters-photo-manager

Suggested internal identifiers:

- Rust workspace: `peters-photo-manager`
- application package: `peters_photo_manager`
- database filename: `peters-photo-manager.db`
- application identifier: `com.peterbeens.photomanager`

The apostrophe should appear only in the user-facing product name.

---

# **Product Vision**

Create a fast and dependable desktop photo manager that gives users direct control over their files.

The application should provide the speed and simplicity associated with traditional desktop photo-management software while adding modern local AI capabilities.

The application should prioritize:

1. speed
2. local operation
3. existing folder structures
4. privacy
5. modularity
6. predictable file handling
7. incremental development
8. cross-platform compatibility

---

# **Core Product Principles**

## **Local First**

The application must work without an Internet connection.

The following should remain on the user’s computer:

- catalogue database
- thumbnails
- image metadata
- tags
- ratings
- captions
- albums
- edit instructions
- AI embeddings
- face information
- OCR results
- search indexes

Cloud services should not be required.

Any future cloud or synchronization feature must be optional and separately enabled.

## **Existing Folders Remain the Source of Truth**

The program should work with photographs where they already exist.

It should not require users to copy photographs into a proprietary library.

The application should:

- display the actual filesystem folder structure
- allow folders to be added to the catalogue
- monitor selected folders for changes
- recognize files added outside the application
- handle renamed or moved files
- support internal and external drives
- preserve records for temporarily disconnected drives

## **Non-Destructive Operation**

Original photographs should not be altered unless the user explicitly requests it.

Future edits should normally be stored as instructions in the catalogue or in optional sidecar files.

Exporting should create a new file containing the selected edits.

## **Speed**

Performance is a primary requirement, not a later optimization.

The application should remain responsive while:

- scanning folders
- generating thumbnails
- extracting metadata
- loading large folders
- processing AI models
- searching the catalogue
- exporting files

Long-running work must run in background tasks and must not block the interface.

## **User Control**

The user must remain in control of:

- file locations
- file moves
- file deletions
- metadata changes
- AI-generated tags
- face groupings
- catalogue rebuilding
- cache removal
- export settings

AI-generated information must be treated as a suggestion rather than permanent truth.

---

# **Technical Direction**

## **Recommended Technology**

Use:

- Rust for core application logic
- Tauri 2 for the cross-platform desktop shell
- TypeScript for the user interface
- SQLite for the local catalogue
- ONNX Runtime for future local AI inference
- a virtualized image grid for thumbnail display
- background worker queues for scanning and image processing

Python should not be used as the primary application language.

Python may be used separately for:

- experiments
- model evaluation
- model conversion
- development utilities
- test-data preparation

Electron should not be the first choice because the application must handle large image collections with controlled memory usage.

Tauri should be tested before the architecture is permanently selected.

If Tauri cannot meet the image-grid performance requirements, Qt with C++ or Rust bindings may be evaluated as an alternative.

---

# **Modular Architecture**

The application should be implemented as a modular codebase.

This does not necessarily mean shipping many separate executable programs.

The initial product will probably ship as one desktop application, but its source code should consist of independent modules, packages, or crates.

This allows different contributors to work on different features without editing one very large source file.

The architecture should separate major responsibilities.

Suggested repository structure:

```text
peters-photo-manager/
├── apps/
│   └── desktop/
│       ├── src/
│       ├── src-tauri/
│       └── package.json
│
├── crates/
│   ├── ppm-catalog/
│   ├── ppm-filesystem/
│   ├── ppm-metadata/
│   ├── ppm-thumbnails/
│   ├── ppm-image-core/
│   ├── ppm-search/
│   ├── ppm-export/
│   ├── ppm-ai/
│   ├── ppm-editing/
│   └── ppm-common/
│
├── docs/
│   ├── architecture/
│   ├── specifications/
│   ├── decisions/
│   └── development/
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── performance/
│
├── scripts/
│
├── Cargo.toml
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

Not every module should be created immediately.

Only create a module when the current milestone requires it.

## **Proposed Modules**

### **Desktop Application**

Responsibilities:

- application window
- menus
- panels
- keyboard commands
- drag and drop
- communication with backend modules
- user preferences

### **Catalogue Module**

Responsibilities:

- SQLite connection
- database migrations
- image records
- folder records
- tags
- ratings
- albums
- edit records
- AI records

This module should not contain user-interface code.

### **Filesystem Module**

Responsibilities:

- recursive folder scanning
- path normalization
- filesystem monitoring
- detecting added or removed files
- detecting renamed files
- removable-drive handling
- safe file operations

### **Metadata Module**

Responsibilities:

- dimensions
- orientation
- image format
- capture date
- camera information
- lens information
- exposure information
- GPS information
- embedded metadata
- sidecar metadata

### **Thumbnail Module**

Responsibilities:

- thumbnail generation
- thumbnail cache
- cache invalidation
- multiple thumbnail sizes
- visible-image prioritization
- background task scheduling

### **Image Core Module**

Responsibilities:

- image decoding
- preview generation
- colour handling
- orientation correction
- image transformations
- format abstraction

### **Search Module**

Responsibilities:

- filename search
- folder search
- metadata search
- tag search
- rating filters
- date filters
- future semantic search

### **Export Module**

Responsibilities:

- image resizing
- output formats
- filename templates
- metadata inclusion
- export presets
- destination handling

### **AI Module**

This should not be implemented in the first milestone.

Future responsibilities:

- model management
- image embeddings
- semantic search
- suggested tags
- face detection
- face embeddings
- face clustering
- OCR
- duplicate similarity
- image quality analysis

### **Editing Module**

This should not be implemented in the first milestone.

Future responsibilities:

- non-destructive edit instructions
- crop
- rotation
- exposure
- colour adjustments
- edit history
- edited preview rendering

### **Common Module**

Responsibilities:

- shared types
- error definitions
- logging interfaces
- configuration types
- task status
- identifiers

The common module must remain small. It should not become a general dumping ground for unrelated code.

---

# **Module Boundaries**

Each module should have a clear public interface.

Modules should not directly access another module’s private implementation.

Examples:

- the thumbnail module may request image decoding from the image-core module
- the user interface may request image records from the catalogue module
- the AI module may store results through the catalogue module
- the export module may request rendered images from the image-core and editing modules

Avoid circular dependencies.

Feature modules should communicate through:

- typed interfaces
- commands
- events
- service abstractions
- clearly defined data structures

Do not place filesystem logic, SQL queries, thumbnail generation, and interface code in the same source file.

---

# **Executable Strategy**

The initial application should probably contain one main executable.

This provides:

- simpler installation
- easier application signing
- easier updates
- easier debugging
- fewer background-process issues

Internally, the executable should use separate Rust crates or modules.

Separate helper executables may be considered later for:

- AI processing
- thumbnail workers
- crash recovery
- background indexing
- plugin isolation

Do not introduce multiple executables until there is a demonstrated technical need.

Modular source code is required.

Multiple shipped executables are optional.

---

# **User Interface Concept**

The main window should eventually contain four areas.

## **Left Sidebar**

Future items:

- folders
- albums
- people
- tags
- saved searches
- favourites
- recently added
- rejected images
- trash

The first version should contain only the folder list.

## **Main Content Area**

Future items:

- thumbnail grid
- chronological view
- folder view
- album view
- search results
- people view
- duplicate review

The first version should contain only a thumbnail grid for the selected folder.

## **Right Information Panel**

Future items:

- filename
- file path
- dimensions
- file size
- capture date
- camera
- lens
- exposure settings
- caption
- tags
- rating
- GPS data
- AI suggestions

The first version may contain only:

- filename
- path
- dimensions
- image format
- file size

## **Bottom Filmstrip**

A filmstrip should eventually appear while viewing a single image.

It is not required in the first version.

---

# **Long-Term Functional Requirements**

The following sections describe the eventual direction of the application.

They are not instructions to implement all features immediately.

## **Folder Management**

The application should eventually support:

- adding watched folders
- recursive folder scanning
- excluded subfolders
- filesystem monitoring
- new-file detection
- renamed-file detection
- removed-file detection
- external drives
- disconnected-drive handling
- safe file moves
- safe file copies
- safe file renaming
- safe deletion
- undo where practical

## **Image Formats**

Initial target formats:

- JPEG
- PNG
- WebP

Later formats:

- GIF
- TIFF
- BMP
- HEIC
- HEIF
- AVIF
- common RAW formats
- JPEG XL
- PSD previews

Do not attempt to support every format in the first milestone.

## **Thumbnail Grid**

The final thumbnail grid should support:

- virtualized rendering
- variable thumbnail sizes
- smooth scrolling
- multi-selection
- keyboard navigation
- visible-thumbnail prioritization
- lazy loading
- background generation
- selection persistence
- sorting
- grouping

## **Image Viewer**

The final viewer should support:

- fit to window
- actual-size view
- zoom
- pan
- next and previous image
- full-screen view
- borderless view
- keyboard navigation
- colour-profile handling
- EXIF orientation
- surrounding-image filmstrip

## **Metadata**

The application should eventually allow:

- tags
- hierarchical tags
- captions
- descriptions
- star ratings
- colour labels
- favourites
- rejection flags
- people names
- location names

The system should distinguish between:

- embedded metadata
- sidecar metadata
- catalogue-only metadata
- AI-generated metadata

## **Albums**

Albums should be virtual collections.

Adding a photograph to an album should not move the original file.

Future album features:

- manual albums
- nested album groups
- custom ordering
- smart albums
- album export
- drag-and-drop membership

## **Drag and Drop**

Future drag-and-drop operations should include:

- photographs into folders
- photographs between folders
- photographs into albums
- tags onto photographs
- photographs onto tags
- people onto photographs
- photographs into export targets
- files from Finder or File Explorer
- files into Finder or File Explorer

## **Export**

Future export options should include:

- original file
- edited copy
- resized copy
- format conversion
- quality setting
- metadata inclusion or removal
- destination selection
- filename templates
- watermarking
- export presets
- folder-structure preservation

## **Non-Destructive Editing**

Initial editing features should eventually include:

- rotate
- crop
- straighten
- exposure
- contrast
- highlights
- shadows
- white balance
- saturation
- vibrance
- black and white
- sharpening
- noise reduction
- red-eye correction

Advanced editing should not be an early priority.

---

# **Local AI Direction**

The AI system should be private and local.

It should not upload photographs to an external service.

The AI architecture should remain optional and modular so that it can be added after the core photo browser is stable.

## **Semantic Search**

A vision-language model should eventually generate an embedding for each photograph.

This would allow natural-language searches such as:

- dog playing in snow
- red sports car
- sunset over water
- people at a wedding
- old brick buildings
- screenshots containing an error
- photographs of food
- winter landscape

The model should run locally through a runtime such as ONNX Runtime.

## **Suggested Tags**

The AI system may suggest tags such as:

- dog
- cat
- bicycle
- car
- beach
- mountain
- snow
- food
- document
- screenshot
- concert

Suggested tags should not automatically become permanent user tags.

The system should distinguish between:

- AI-searchable concepts
- pending tag suggestions
- accepted tags
- rejected tags
- manually created tags

## **Face Grouping**

Future face functionality may include:

- face detection
- face embeddings
- similarity clustering
- unnamed person groups
- person naming
- group merging
- group splitting
- incorrect-face removal

Face processing must be optional.

## **OCR**

Future OCR should extract searchable text from:

- screenshots
- signs
- photographed documents
- receipts
- whiteboards
- presentation slides
- labels

OCR text should be stored in the catalogue and should not automatically be written into the original photograph.

## **Duplicate Detection**

The system should distinguish among:

- exact duplicates
- resized copies
- recompressed copies
- edited copies
- visually similar photographs
- burst sequences

Exact duplicates may use file hashes.

Visual similarity may use perceptual hashes or AI embeddings.

## **Image Quality Analysis**

Possible later filters:

- blurry images
- closed eyes
- underexposed images
- overexposed images
- low-resolution images
- screenshots
- scanned documents
- probable burst sequences

These should be review tools.

They should never automatically delete photographs.

---

# **Database Direction**

Use SQLite for the catalogue.

Possible future database entities:

- source folders
- image files
- file identities
- metadata
- thumbnails
- tags
- image-tag relationships
- ratings
- albums
- album membership
- people
- detected faces
- edit instructions
- exports
- AI models
- image embeddings
- OCR results
- duplicate groups
- background jobs
- application settings

Only create tables required for the current milestone.

Use database migrations from the beginning.

Do not create the complete future schema in the first version.

---

# **File Identity**

Do not rely only on file paths.

Users may rename or move photographs.

A future file identity system may use:

- normalized path
- file size
- modified timestamp
- partial content hash
- full content hash
- filesystem identifier where available

The initial milestone may use normalized paths, but the design should allow a stronger identity system later.

---

# **Error Handling**

The application must not crash because one image cannot be decoded.

Errors should be:

- logged
- associated with the relevant file
- visible to the user where appropriate
- recoverable where possible

Examples:

- unsupported file format
- corrupted image
- inaccessible folder
- disconnected drive
- permission failure
- database failure
- thumbnail-generation failure

Background tasks should continue processing other files after a recoverable error.

---

# **Logging**

Use structured logging.

Logs should include:

- application startup
- application version
- operating system
- folder scans
- number of files discovered
- thumbnail tasks
- database migrations
- errors
- performance measurements
- background-task failures

Do not log private image contents, AI embeddings, or unnecessary personal metadata.

---

# **Testing Requirements**

The project should include:

- unit tests for individual modules
- integration tests for module interactions
- database migration tests
- filesystem fixture tests
- corrupt-file tests
- performance tests
- cross-platform build tests

Test fixtures should include:

- valid JPEG files
- valid PNG files
- unsupported files
- corrupted files
- duplicate filenames
- nested folders
- empty folders
- inaccessible files where practical
- files with unusual characters
- long paths
- rotated images
- images without metadata

---

# **Performance Requirements**

Initial performance goals:

- launch quickly with an existing catalogue
- show the first cached thumbnails in under one second
- avoid blocking the interface during folder scans
- navigate between cached images without noticeable delay
- scroll smoothly through large thumbnail collections
- keep memory usage controlled
- avoid loading full-resolution images for thumbnail display

Performance measurements should be collected from the first milestone.

Do not postpone performance testing until the application is feature-complete.

---

# **Development Phases**

## **Phase 0: Repository and Architecture Setup**

Purpose:

Create the minimum project structure required for iterative development.

Tasks:

- Create the Rust workspace
- Create the Tauri desktop application
- Create only the modules needed for Phase 1
- Add basic logging
- Add project documentation
- Add formatting and linting
- Add a basic test framework
- Add continuous integration for macOS and Windows builds
- Document architecture decisions

Do not implement AI, editing, albums, exporting, or advanced metadata.

## **Phase 1: Basic Folder Browser**

Purpose:

Prove that the application can select a folder and discover supported image files.

Features:

- Launch the desktop application
- Allow the user to choose one folder
- Scan the folder for JPEG, PNG, and WebP files
- Display filenames in a basic list
- Show scan progress
- Handle unreadable files without crashing
- Store the selected folder in application settings
- Run on macOS
- Run on Windows

Do not generate thumbnails yet unless required for the next phase.

Success criteria:

- the application opens
- the user selects a folder
- supported image files appear
- the interface remains responsive
- failures are logged
- the same codebase builds on macOS and Windows

## **Phase 2: Thumbnail Grid**

Purpose:

Prove that photographs can be displayed quickly.

Features:

- Generate thumbnails
- Cache thumbnails locally
- Display a virtualized thumbnail grid
- Prioritize visible thumbnails
- Support single selection
- Display loading and error states
- Measure scrolling performance
- Measure memory usage

Success criteria:

- large folders remain usable
- scrolling is smooth
- thumbnails are reused after restart
- the interface does not freeze during generation

## **Phase 3: Basic Image Viewer**

Features:

- Open a selected thumbnail
- Display a larger preview
- Fit the image to the window
- Navigate to the next image
- Navigate to the previous image
- Support keyboard navigation
- Return to the thumbnail grid

## **Phase 4: Persistent Catalogue**

Features:

- Add SQLite
- Store folder records
- Store file records
- Store basic metadata
- Add database migrations
- Reopen the existing catalogue on startup
- Detect missing files
- Detect newly added files

## **Phase 5: Basic Metadata Panel**

Features:

- Show filename
- Show full path
- Show image dimensions
- Show file size
- Show image format
- Show capture date where available
- Show basic camera metadata where available

## **Phase 6: Ratings and Manual Tags**

Features:

- Add star ratings
- Add favourites
- Create manual tags
- Assign tags to images
- Remove tags from images
- Filter by tag
- Filter by rating
- Persist all changes in SQLite

## **Phase 7: Basic File Operations**

Features:

- Rename a photograph
- Move a photograph
- Copy a photograph
- Delete a photograph
- Confirm destructive actions
- Handle naming conflicts
- Refresh the catalogue after operations

## **Phase 8: Albums**

Features:

- Create an album
- Add photographs to an album
- Remove photographs from an album
- Reorder album photographs
- Export album contents later

## **Phase 9: Basic Export**

Features:

- Export original files
- Export resized copies
- Select output format
- Select JPEG quality
- Choose destination folder
- Prevent accidental overwriting

## **Phase 10: First Local AI Prototype**

Purpose:

Prove that local semantic image search is practical.

Features:

- Select one local image-embedding model
- Run inference locally
- Generate embeddings for a small test collection
- Store embeddings
- Convert a text query into an embedding
- Rank images by similarity
- Display semantic search results
- Measure indexing speed
- Measure search speed
- Measure memory usage
- Test Apple Silicon
- Test Windows

Do not add face recognition, OCR, or automatic tagging in this phase.

## **Later Phases**

Possible later phases:

- suggested tags
- smart albums
- non-destructive rotation
- cropping
- exposure adjustments
- face detection
- face clustering
- OCR
- duplicate detection
- visually similar image search
- slideshow
- map view
- printing
- RAW support
- video support
- plugins
- synchronization

Each later phase must receive its own specification before implementation begins.

---

# **Immediate Scope**

The initial implementation request is limited to Phase 0 and Phase 1.

Do not implement later phases.

The first deliverable should be a minimal cross-platform application that:

1. launches successfully
2. allows the user to select one folder
3. scans that folder for JPEG, PNG, and WebP files
4. displays the matching filenames
5. remains responsive while scanning
6. records useful logs
7. handles inaccessible or invalid files safely
8. builds on macOS and Windows

The codebase should be structured so thumbnail generation can be added in the next phase.

Do not implement:

- AI
- SQLite catalogue
- editing
- albums
- exporting
- face recognition
- OCR
- duplicate detection
- mapping
- advanced metadata
- RAW image support
- video support
- plugins
- synchronization

---

# **Documentation Requirements**

Maintain the following documents:

## **README.md**

Include:

- project purpose
- current status
- supported platforms
- supported features
- build instructions
- test instructions
- known limitations
- roadmap summary

## **docs/specifications/software-specification.md**

Store the complete product specification.

## **docs/development/current-phase.md**

Include:

- current phase
- current objective
- included features
- excluded features
- acceptance criteria
- unresolved issues

## **docs/development/backlog.md**

Include future features without implementing them.

## **docs/decisions/**

Store architectural decision records.

Examples:

- choice of Tauri
- choice of Rust
- choice of SQLite
- thumbnail-library selection
- AI-runtime selection

---

# **Coding Standards**

- Keep files focused on one responsibility.
- Prefer small modules over large multipurpose files.
- Avoid files that grow beyond a reasonable review size.
- Use descriptive names.
- Use explicit error types.
- Avoid hidden global state.
- Document public interfaces.
- Add tests with each feature.
- Do not leave unused experimental code in production modules.
- Do not suppress compiler warnings without explanation.
- Do not use unsafe Rust unless documented and justified.
- Keep operating-system-specific code behind platform abstractions.
- Do not duplicate macOS and Windows business logic.
- Keep user-interface state separate from catalogue and filesystem logic.

---

# **Contributor-Friendly Design**

The project should support multiple contributors working independently.

To support this:

- assign features to individual modules
- maintain clear module ownership
- define public interfaces before parallel work begins
- avoid broad shared files edited by every contributor
- use small pull requests
- require tests for changed behaviour
- document architectural decisions
- keep feature branches narrow
- avoid combining formatting changes with functional changes
- identify dependencies between proposed features before assigning work

Example contributor areas:

- filesystem scanning
- thumbnail generation
- metadata extraction
- database design
- thumbnail-grid interface
- image viewer
- exporting
- semantic AI
- face grouping
- OCR
- Windows integration
- macOS integration
- testing
- documentation

---

# **Definition of Done for Each Feature**

A feature is complete only when:

- the feature works as specified
- automated tests are included where practical
- errors are handled
- logs are useful
- documentation is updated
- no unrelated features were added
- macOS behaviour has been tested
- Windows behaviour has been tested or clearly marked pending
- performance impact has been considered
- the application remains runnable
- the next phase has not been started prematurely

---

# **Initial Instruction to the Development Agent**

Build Peter’s Photo Manager incrementally.

Begin only with repository setup and the basic folder-browser phase.

Do not attempt to build the full photo manager.

Before writing code:

1. summarize the proposed Phase 0 and Phase 1 implementation
2. identify the exact files and modules that will be created
3. identify the minimum dependencies
4. explain how scanning will remain off the user-interface thread
5. define the Phase 1 acceptance tests

Then implement only the approved current phase.

At the end of the phase:

1. run the tests
2. run formatting and linting
3. report the files created or changed
4. report any known limitations
5. update the current-phase document
6. stop before beginning the next phase

The important distinction is that the project can ship as one application while still being divided internally into many independent modules. That is generally preferable to distributing many executables at the beginning.
