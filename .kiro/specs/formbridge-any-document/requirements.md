# Requirements Document

## Introduction

Today FormBridge accepts only fillable PDFs (AcroForm PDFs with interactive fields). Many people hold something else: a paper form, a phone photo of it, a screenshot, a scan, a PDF with no fields, or a Word file. This spec extends FormBridge so that it helps you prepare your answers for these documents too.

The main user is an older person or a person with little computer experience, often with only a phone, who may not know what "upload" or "PDF" means. Their photos may be shaky, skewed, glary or small-print. The design of every screen in this spec starts from that person.

Every input is turned into one internal **Document_Model**: pages, text lines with boxes and confidence, candidate labels, and the real form fields when the document has them.

- A PDF with real form fields keeps the existing `formbridge-pdf` path and is filled exactly as before.
- Every other input goes through these steps, all in the browser except step 5: decode the file locally; read text from the PDF text layer, or recognise it with an OCR_Engine that runs in the browser; pick Label_Candidates with fixed local rules; let the user review the list of labels that will be sent; send only the kept labels to the AI service for questions; run the existing question wizard; produce an Answer_Sheet.

The Answer_Sheet is a large-print page, printable and downloadable, that lists each original label with its page reference and the user's answer, plus a "show this to the clerk" summary. The user copies the answers onto the paper form or shows the sheet at the counter. This spec does not write answers onto a photo or a scan in Slice 1.

This spec reuses the existing pipeline instead of duplicating it: the Language_Registry and locale files, the analysis schema shape and the `AiProvider` interface with its real and mock providers, the `AI_MODE` switch (mock by default), the question wizard (`QuestionWizard`, `FieldQuestion`, `ValidationMessage`, `MachineTranslatedLabel`, `StatusMessage`, `ScreenHeading`), the review screen, the country-pack validators (`MY`, `US`, `universal`) and their single `validateAnswer` entry point, the description Translation_Button, the shared error shape, the rate-limiting binding, the Demo mode banner, and the privacy rules for logs and storage.

Honest scope: the app helps you prepare your answers. It does not claim to accept every file, to read every document correctly, to be accurate, or to make a form compliant. Handwriting is not supported. Recognised text is shown with a "check this yourself" notice wherever its quality is uncertain.

### Delivery slices

Every requirement carries a **Slice** line. Where a requirement mixes slices, the line names the criteria that belong to Slice 2, and those criteria start with a `WHERE <feature> is delivered (Slice 2)` clause. Slice 1 criteria never depend on a Slice 2 criterion.

- **Slice 1** (about seven working days; the only slice needed for acceptance): the two large entry buttons and camera capture; file recognition by signature with the refusal message for unsupported formats; limits, decoding errors and the slow-page notice; the Document_Model; the unchanged fillable-PDF path; PDFs without fields (text pages and scanned pages, page by page); clean printed JPEG and PNG photos and screenshots with EXIF orientation and a manual rotate control; the self-hosted OCR_Engine with one validated OCR_Language chosen from the form language (English plus Malay if both pass the validation bar, otherwise English only); simple Retake_Advice; the fail-closed Label_Classifier; the Label_Review screen with a Page_Crop beside every item; label analysis through the existing AI layer; Original_Label_Mode when AI or the network is unavailable; the existing wizard with one question per screen, a fictional worked example, "I do not know" help, Back, undo and honest progress; read-aloud only when a local voice exists; large text, high contrast, 44 px targets and no user-facing timeouts; memory-only answers with a `beforeunload` warning; the "ask someone you trust" hint; the printable large-print Answer_Sheet with Print and Share; the privacy changes; the accessibility checks; the tests.
- **Slice 2** (optional): automated photo-quality checks with one specific instruction at a time; crop; more OCR_Languages, including Simplified Chinese, Traditional Chinese and Tamil success (unless a spike in Slice 1 proves one of them ready); WebP, HEIC, SVG, DOCX and TXT inputs; the Overlay output; advanced recovery (re-reading a single page in another OCR_Language, reordering pages).

### Bounded privacy threat model

This section states what the privacy design protects against and where its limits are. Requirements 11, 13, 14, 20 and 24 implement it.

- **Asset.** Personal data written on the document (names, ID numbers, phone numbers, addresses, health details) and every answer the user types.
- **Threat.** That personal data reaches the Worker, the AI service, a log, a cache, a telemetry service or any other network destination without the user deciding to send it.
- **What leaves the browser.** Only Kept_Labels: Label_Candidate text that the user has seen on the Label_Review screen, next to its Page_Crop, and left in the send list. Plus, as today, one description answer the user types and asks to translate, after pressing the Translation_Button. Requests for the app's own static files and OCR_Assets carry no document or answer data.
- **What never leaves the browser automatically.** The file, decoded page images, Page_Crops, all OCR and text-layer output that is not a Kept_Label, and every answer.
- **Fail-closed rule.** The Label_Classifier decides locally by fixed rules. A line that matches a value pattern is never offered for sending. A line the rules cannot classify as a likely label starts unselected and is sent only if the user explicitly keeps it. If the classifier fails on a page, nothing from that page can be selected or sent; the other pages are unaffected.
- **Limit.** No classifier can prove arbitrary text free of personal data. The rules and fixtures are tested by property and canary tests, and the user is the last check. The app does not claim universal privacy; the privacy notice states that labels the user keeps are sent to the AI service.
- **User-directed exports.** Print, Share and download of the Answer_Sheet are the user's own actions and are allowed. They are different from automatic network disclosure.
- **Out of scope.** Cross-device hand-off (for example a QR code that moves a session to another device), because it would move private answers outside the browser. Protection against malware or extensions already inside the user's browser.

### Acceptance scenarios

Each scenario names its slice. Requirement 27 turns them into Playwright tests, which use a mock OCR result and the mock AiProvider by default. Requirement 25.5 adds real-OCR checks for scenarios 2, 3 and 4, and Requirement 26 covers the human part of scenario 10.

1. **Fillable form regression (Slice 1).** You open an existing fillable `MY` or `US` sample form. Everything works exactly as before: same questions, same validation, same filled PDF.
2. **Clean phone photo (Slice 1).** You take a photo of a clean printed paper form. The app reads it, shows the labels it found with a crop of the page beside each, asks the questions one at a time and gives you a large-print Answer_Sheet.
3. **Rotated photo (Slice 1).** Your photo is sideways. The app applies the photo's own orientation information, and if the text is still sideways, you turn it with the rotate control and the app reads it.
4. **Poor photo (Slice 1 generic advice; Slice 2 specific advice).** Your photo is glary or blurry. The app finds almost no readable text and tells you, in plain words, to take the photo again. You retake it and continue. In Slice 2 the app checks the photo before reading it and gives one specific instruction, such as "Move away from the light".
5. **Mixed PDF (Slice 1).** You choose a PDF where some pages carry text and others are scans. The app reads the text pages directly and recognises the scanned pages, page by page, in page order.
6. **Chinese or Tamil form (Slice 2).** You choose a Chinese or Tamil printed form. The app reads it, shows clear quality warnings, and you review the labels and answer the questions.
7. **No network or no AI quota (Slice 1).** The AI service is unreachable or the daily quota is used up. The app still shows the original labels from the document as questions, and you finish an Answer_Sheet.
8. **Prefilled sensitive form (Slice 1).** You choose a form that already carries a name, an ID number, a phone number and free text. A network inspection during the whole flow shows that none of those values, and none of your answers, leaves the browser.
9. **Unsupported file (Slice 1).** You choose an RTF file. The app tells you in plain words that it cannot open this kind of file and suggests that you take a photo of the paper instead.
10. **First-time user on a phone (Slice 1).** A person who has never used the app completes scenario 2 on a phone, using only the two large entry buttons and read-aloud where a voice exists, in the interface language of their choice.

## Glossary

- **ReForge_App**: the ReForge AI web app (React + Vite frontend and Cloudflare Worker in one deployment).
- **FormBridge**: the form-assistance module of the ReForge_App, specified in `formbridge-pdf` and extended by this spec.
- **Worker**: the Cloudflare Worker that serves the frontend, the static assets and the API routes.
- **AiProvider**: the existing single AI provider interface with the real Workers AI provider and the deterministic mock provider.
- **AI_Mode**: the existing setting that selects the real provider (`AI_MODE=real` with the Workers AI binding present) or the mock provider (any other case).
- **Language_Registry**: the existing registry of interface languages and locale files.
- **Core_Language**: a Language_Registry entry with translation status `core`.
- **Country_Pack**: the existing validation packs (`MY`, `US`, `universal`), chosen through the Country Pack Registry and called through `validateAnswer`.
- **Interface_Language**: the language the user reads the app in.
- **Form_Language**: the language the document expects answers to be written in.
- **Form_Country**: the country whose Country_Pack validates answers.
- **OCR_Language**: the language model the OCR_Engine uses to recognise text on a page. It is a separate setting from the Interface_Language and the Form_Language.
- **Validated_OCR_Language**: an OCR_Language that has passed the OCR_Validation_Bar and is offered to users. In Slice 1 the set is English, plus Malay if Malay passes.
- **OCR_Validation_Bar**: the measurable quality bar, defined in Requirement 9.1, that an OCR_Language must pass on the synthetic photo fixtures before it is offered.
- **Input_File**: one file the user gives to FormBridge, from the camera or from the device.
- **Entry_Screen**: the FormBridge screen with the two large entry buttons.
- **File_Sniffer**: the browser code that identifies the kind of an Input_File from its leading bytes and container structure.
- **Source_Kind**: the kind the File_Sniffer assigns: `fillable-pdf`, `pdf-without-fields`, `jpeg`, `png`, `webp`, `heic`, `svg`, `docx`, `txt`, `refused` (a recognised format the app does not open, such as RTF or legacy `.doc`) or `unknown`.
- **Fillable_Path**: the existing `formbridge-pdf` pipeline for PDFs with AcroForm fields, from extraction to the filled PDF.
- **Document_Path**: the pipeline of this spec for every Source_Kind other than `fillable-pdf`, from decoding to the Answer_Sheet.
- **Document_Model**: the one internal description of an Input_File, together with any photos added to it with "Add another page" (Requirement 7.5): its Source_Kind, its ordered pages, the Text_Lines of each page, the Label_Candidates, and, for a `fillable-pdf`, its existing field evidence.
- **Page**: one entry of the Document_Model with a one-based page number, a width and height in pixels of its working image (or PDF user-space units for a text page), a rotation, a Page_Text_Source and its Text_Lines.
- **Page_Text_Source**: how the text of a Page was obtained: `text-layer` (pdf.js text content) or `ocr` (OCR_Engine output).
- **Working_Image**: the bitmap of one Page that the Document_Path keeps in memory for OCR and Page_Crops, scaled so that its long edge is within the Long_Edge_Range.
- **Long_Edge_Range**: the long-edge size of a Working_Image, between 2000 and 2500 px; the design fixes the value and may change it after the phone tests.
- **Text_Line**: one line of text on a Page with its text, its bounding box in Page coordinates, its reading-order index and, for `ocr` pages, a confidence from 0.0 to 1.0.
- **OCR_Engine**: the in-browser text recognition engine, running in one reusable OCR_Worker.
- **OCR_Worker**: the single background web worker in which the OCR_Engine runs, off the main thread.
- **OCR_Assets**: the OCR_Engine code, its WebAssembly and its language data files, all served from the Worker's own origin.
- **Low_Quality_Page**: a Page whose OCR result falls below the thresholds of Requirement 9.4.
- **Retake_Advice**: the plain-language message, with a retake control, shown for a Low_Quality_Page.
- **Label_Classifier**: the deterministic browser code that sorts every Text_Line into exactly one Label_Class by the rules of Requirement 11.
- **Label_Class**: one of `likely-label`, `ambiguous` and `value-like`.
- **Label_Candidate**: a Text_Line, or the label part of a Text_Line, whose Label_Class is `likely-label` or `ambiguous`.
- **Answer_Area**: a region of a Page where a person writes an answer, as the design defines it (for example a box, an underline, a dotted leader, or the rest of a line after a label that ends with a colon).
- **Label_Id**: the stable local identifier of a Label_Candidate, derived from its page number and reading-order index only.
- **Label_Review**: the screen that lists the Label_Candidates, each with its Page_Crop, and shows exactly what will be sent.
- **Page_Crop**: a zoomable image of the part of the original Page around one Label_Candidate, drawn in the browser from the Working_Image or the rendered PDF page.
- **Kept_Label**: a Label_Candidate that is in the send list when the user confirms the Label_Review, with any text edit the user made.
- **Label_Analysis_Request**: the request that carries Kept_Labels to the Worker for AI-written questions.
- **Label_Analysis**: the AI reply for one Kept_Label: Label_Id, human label, question, answer type, confidence, and optionally a plain-language explanation and a fictional example.
- **Original_Label_Mode**: the mode in which the wizard asks each question as a fixed locale sentence that quotes the Kept_Label text unchanged, without AI.
- **Question_Wizard**: the existing FormBridge one-question-per-step screen, extended by this spec.
- **Review_Screen**: the existing FormBridge review screen, extended by this spec.
- **Translation_Button**: the existing control that sends one description answer to `/api/forms/translate` after the user presses it.
- **Fictional_Example**: an example answer shown on a question step, labelled as an example that is not real and never inserted into the answer.
- **Read_Aloud**: the control that speaks a question or explanation with the browser's built-in speech synthesis, using a local voice.
- **Local_Voice**: a voice the browser reports through the Web Speech API with `localService` true and a language matching the text to be spoken.
- **Answer_Sheet**: the large-print output of the Document_Path described in Requirement 19.
- **Clerk_Summary**: the part of the Answer_Sheet, written in the Form_Language, that the user can show to a person at a counter.
- **Overlay**: the Slice 2 output that draws answers onto a page image at positions the user places.
- **Privacy_Steering**: the repository's privacy rules file at `.kiro/steering/privacy.md`.
- **Privacy_Notice**: the existing locale strings `upload.privacyNotice` and `review.privacyNotice`, plus any new notice keys this spec adds.
- **Canary_Value**: a unique test string placed in a document or an answer to prove that it does not reach a place it must not reach.
- **Smoke_Test**: a test that the developer runs on purpose, outside CI and outside the default test command, either with `AI_MODE` set to `real` or against the deployed public URL.
- **Usability_Test_Record**: the dated record in `docs/` of sessions with representative users, described in Requirement 26.
- **Slice_1** (written "Slice 1") and **Slice_2** (written "Slice 2"): the delivery slices described in "Delivery slices".

## Requirements

### Requirement 1: Entry screen in plain words

**Slice:** 1

**User Story:** As an older user who does not know what "upload" or "PDF" means, I want two large, clearly named choices, so that I can start without help.

#### Acceptance Criteria

1. WHEN FormBridge opens after the language picker, THE Entry_Screen SHALL show exactly two primary buttons, labelled in the Interface_Language with the meaning "Take a photo of your form" and "Choose a file from this device", each at least 64 CSS px tall and at least 44 CSS px wide at every viewport width of 360 CSS px or more.
2. THE Entry_Screen SHALL contain none of the terms "upload", "PDF", "OCR", "file format" and "MIME", matched case-insensitively, in any visible string of the `en` locale file (this closed list excludes only the file's own extension inserted into the message of Requirement 2.5), and every Core_Language locale file SHALL carry a non-empty translation of every Entry_Screen key.
3. WHEN the user presses "Take a photo of your form", THE ReForge_App SHALL open a file input with `accept="image/*"` and the `capture` attribute set, and SHALL show no text stating that the camera opened.
4. WHEN the user presses "Choose a file from this device", THE ReForge_App SHALL open a file input with no `capture` attribute and no `accept` filter that hides any file, so that `refused` and `unknown` files reach the File_Sniffer.
5. THE Entry_Screen SHALL place the existing sample-form link after both primary buttons in visual, reading and focus order, make the link shorter than either primary button, and give the link a style other than the filled primary button style.
6. THE Entry_Screen SHALL show a line in the Interface_Language stating that handwriting cannot be read and that printed forms work best.
7. IF the user closes the file picker or the camera without choosing a file, THEN THE ReForge_App SHALL stay on the Entry_Screen, show no error, and return focus to the button that opened the picker or the camera.

### Requirement 2: File recognition and routing

**Slice:** 1, except criterion 2.6 (Slice 2)

**User Story:** As a user, I want the app to recognise what I gave it and tell me plainly when it cannot open it, so that I never get a confusing error.

#### Acceptance Criteria

1. WHEN the user gives an Input_File, THE File_Sniffer SHALL assign exactly one Source_Kind from the file's bytes and container structure alone. The file name extension and the browser-reported MIME type SHALL never change the Source_Kind and SHALL be used only for the wording of the message of criterion 2.5.
2. THE File_Sniffer SHALL assign:
   - `fillable-pdf` to a PDF whose AcroForm dictionary lists at least one field or carries an XFA entry, so that the existing XFA rejection of the Fillable_Path still applies;
   - `pdf-without-fields` to any other PDF, including an encrypted PDF whose AcroForm dictionary cannot be read, for which criterion 3.6 then shows the encryption message;
   - `jpeg` and `png` by their signatures;
   - `refused` to RTF, legacy Word (`.doc` compound files), and any other format that the design lists as recognised but not opened;
   - `unknown` to an empty file and to any bytes that match no signature.
3. WHEN the Source_Kind is `fillable-pdf`, THE ReForge_App SHALL hand the Input_File to the Fillable_Path unchanged, including its existing limits and its existing rejection messages for XFA, encrypted and signed PDFs.
4. WHEN the Source_Kind is `pdf-without-fields`, `jpeg` or `png`, THE ReForge_App SHALL hand the Input_File to the Document_Path. This replaces the existing rejection of PDFs with no interactive form fields (`formbridge-pdf` Requirement 1.3, "PDFs with no interactive form fields"), and the existing test for that rejection SHALL be changed to assert the new routing.
5. IF the Source_Kind is `refused` or `unknown`, THEN THE ReForge_App SHALL stay on the Entry_Screen, process the file no further, show in the Interface_Language and in plain words that the app cannot open this kind of file, and suggest taking a photo of the paper form instead, with a control that opens the camera input of Requirement 1.3. The message SHALL name no file format jargon other than the file's own extension when the file has one.
6. WHERE additional input formats are delivered (Slice 2), THE File_Sniffer SHALL assign `webp`, `heic`, `svg`, `docx` and `txt` by signature or container structure and route them as Requirement 21 states. WHILE a format is not delivered, THE File_Sniffer SHALL assign it `refused`.
7. FOR ALL byte sequences from 0 to 15,728,640 bytes long, THE File_Sniffer SHALL return exactly one Source_Kind and SHALL complete without throwing.
8. THE File_Sniffer SHALL read at most the first 65,536 bytes of an Input_File to assign a Source_Kind, except for a container format (PDF in Slice 1; DOCX in Slice 2), for which the design names a bounded structure read and its maximum byte count.
9. THE File_Sniffer SHALL run in the browser and send no byte of the Input_File to any destination, and THE test suite SHALL include a Canary_Value test that proves it.

### Requirement 3: Limits, decoding errors and memory

**Slice:** 1

**User Story:** As a user on an older phone, I want the app to refuse what it cannot handle before it freezes my phone, so that I get a clear message instead of a crash.

#### Acceptance Criteria

1. THE Document_Path SHALL accept an Input_File of at most 15,728,640 bytes (15 MB). IF an Input_File routed to the Document_Path is larger, THEN THE ReForge_App SHALL refuse it before decoding any byte beyond those the File_Sniffer read, with a message in the Interface_Language that states the limit as "15 MB" and suggests a smaller photo, and SHALL keep the Entry_Screen operable.
2. THE Document_Path SHALL process at most 5 Pages per Input_File. IF a PDF routed to the Document_Path has more than 5 pages, THEN THE ReForge_App SHALL state the 5-page limit before processing any page and offer two controls, "continue with pages 1 to 5" and "stop", where "stop" returns to the Entry_Screen keeping no page data.
3. IF the width multiplied by the height of an image, read from its header, or of a PDF page, read from its page dimensions at the render scale, exceeds 20,000,000 pixels, THEN THE Document_Path SHALL skip that image or page without allocating a bitmap for it and continue with the other pages, and THE ReForge_App SHALL tell the user in the Interface_Language which page was skipped and why.
4. THE Document_Path SHALL scale every Working_Image up or down so that its long edge lies within the Long_Edge_Range, keeping the aspect ratio within 1 px.
5. THE Document_Path SHALL decode, render and recognise one Page at a time, in page order, SHALL hold at most one full-size bitmap at any moment, and SHALL release that bitmap before starting the next Page.
6. IF an Input_File routed to the Document_Path is malformed, truncated, encrypted, or fails to decode, THEN THE ReForge_App SHALL show a message in the Interface_Language that names the problem in plain words and offers to try another file or take a photo, SHALL discard any partial Document_Model, and SHALL keep the Entry_Screen usable without a page reload.
7. THE design SHALL record the numeric limits of this requirement in one place in the code as named constants (15 MB, 5 pages, 20,000,000 pixels, the Long_Edge_Range and the 60-second slow-page notice of criterion 3.8), and SHALL note that the limits may be adjusted after the phone tests of Requirement 26.
8. IF decoding, rendering or recognising one Page takes longer than 60 seconds, THEN THE ReForge_App SHALL show a plain message in the Interface_Language with a "keep waiting" control, a "stop" control and a hint to try a smaller or clearer photo, and SHALL continue processing until the user presses "stop".

### Requirement 4: One Document_Model for every input

**Slice:** 1

**User Story:** As the developer, I want every input normalised into one model, so that the label review, the wizard and the review screen are shared code.

#### Acceptance Criteria

1. THE Document_Path SHALL produce exactly one Document_Model per Input_File that lists its Source_Kind and its Pages numbered in ascending order from 1 with no gaps, with each Page carrying its page number, its width and height (in Working_Image pixels for image and `ocr` Pages, in PDF user-space units for `text-layer` Pages), its rotation, its Page_Text_Source and its Text_Lines.
2. THE Document_Model SHALL give every Text_Line a reading-order index that is a non-negative integer unique within its Page, and a bounding box in Page coordinates whose edges lie between 0 and the Page width horizontally and between 0 and the Page height vertically.
3. THE Document_Model SHALL hold at most one Label_Candidate per Text_Line, where the label part before a label-ending colon counts as that Text_Line's Label_Candidate, and SHALL give every Label_Candidate a Label_Id derived only from its page number and reading-order index, so that Label_Ids are identical across rebuilds of the same input, unique within the Document_Model, and unchanged by a text edit on the Label_Review.
4. THE ReForge_App SHALL keep the Document_Model, the Working_Images and the Page_Crops in memory only, SHALL write none of them to localStorage, sessionStorage, IndexedDB, cookies or the Cache Storage API, and SHALL send none of them to any destination, except the Kept_Label fields of the Label_Analysis_Request (Requirement 13.1).
5. THE Question_Wizard and the Review_Screen SHALL consume Kept_Labels from the Document_Model through the same field state that the Fillable_Path uses, so that one set of wizard, validation and review components serves both paths.
6. FOR ALL Document_Models, the Label_Candidates SHALL be ordered by page number and then by reading-order index, and the Question_Wizard SHALL present Kept_Labels in that order.
7. IF the same Label_Candidate text appears more than once in a Document_Model, THEN THE Document_Model SHALL keep each occurrence as a separate Label_Candidate with its own Label_Id and its own page number.
8. WHEN the user chooses a new Input_File from the Entry_Screen, reloads the page or closes the page, THE ReForge_App SHALL discard the previous Document_Model, its Working_Images, its Page_Crops and every answer. A photo added with "Add another page" (Requirement 7.5) is not a new Input_File for this criterion.

### Requirement 5: Fillable-PDF path unchanged

**Slice:** 1

**User Story:** As an existing user, I want fillable forms to keep working exactly as before, so that the new inputs cost me nothing.

#### Acceptance Criteria

1. WHEN the Source_Kind is `fillable-pdf`, THE ReForge_App SHALL run the Fillable_Path with the same extraction, analysis request, validation, review and PDF filling behaviour as before this spec, and SHALL NOT show the Label_Review, start the OCR_Worker or build Text_Lines for that file.
2. THE existing `formbridge-pdf` test suite, including the Malaysian clinic and US community clinic end-to-end scenarios, SHALL pass after this spec is implemented, with no change to any test except the routing test named in Requirement 2.4.
3. FOR every bundled fillable fixture, THE Fillable_Path SHALL send an analyze request body byte-identical to the one it sent before this spec, and every precomputed fixture cache entry SHALL still be found and pass schema validation.

### Requirement 6: PDFs without fields, page by page

**Slice:** 1

**User Story:** As a user with a PDF that has no fill-in boxes, or a scanned PDF, I want the app to read each page in the right way, so that I still get questions.

#### Acceptance Criteria

1. WHEN the Document_Path processes a Page of a `pdf-without-fields` Input_File, THE Document_Path SHALL first read the page's text content with pdf.js and count the non-whitespace characters drawn inside the page's visible area. IF the count is at least the minimum set by a named design constant, THEN THE Document_Path SHALL use that text as the Page's Text_Lines with Page_Text_Source `text-layer`.
2. IF the count of criterion 6.1 is below the minimum, THEN THE Document_Path SHALL render that Page in the browser to a Working_Image whose long edge lies within the Long_Edge_Range and recognise it with the OCR_Engine, with Page_Text_Source `ocr`.
3. WHEN a PDF mixes text pages and scanned pages, THE Document_Model SHALL record each Page with the Page_Text_Source decided for that Page by criteria 6.1 and 6.2 alone, and SHALL keep the original page order.
4. THE Document_Path SHALL build no Text_Line from PDF annotations, form appearance streams, text drawn in the invisible rendering mode, or text outside the page's visible area, so that a page whose only text is an invisible OCR layer falls back to OCR under criterion 6.2.
5. WHEN the Document_Path shows a page reference to the user, THE ReForge_App SHALL use the one-based page number of the original document, including after the user continued with pages 1 to 5 under Requirement 3.2.
6. WHEN a Page has a non-zero rotation, THE Document_Model SHALL record that rotation and give every Text_Line box in upright, as-displayed coordinates, which the Page_Crops use.
7. IF one Page fails to render or its text cannot be read, THEN THE ReForge_App SHALL name that page number in the Interface_Language, keep the other Pages, and offer to continue without that Page or to retake it as a photo.

### Requirement 7: Photos and screenshots

**Slice:** 1

**User Story:** As a user with a phone photo or a screenshot of a form, I want the app to turn it the right way up, so that it can read the text.

#### Acceptance Criteria

1. WHEN the Document_Path decodes a `jpeg` Input_File with an EXIF orientation value from 1 to 8, THE Document_Path SHALL apply that orientation exactly once, so that every value yields an upright Working_Image and a photo the browser already shows upright is not rotated a second time.
2. WHEN the Document_Path has decoded a `jpeg` or `png` Input_File, THE ReForge_App SHALL show the page image with a rotate control of at least 44 by 44 CSS px that turns the image 90 degrees clockwise per press, so that four presses return it to its starting orientation, before OCR starts and again on the Retake_Advice screen.
3. WHEN the user rotates a page image, THE Document_Path SHALL discard that Page's OCR result, Text_Lines and Label_Candidates, recognise the rotated Working_Image again, and leave every other Page unchanged.
4. THE Document_Path SHALL treat one `jpeg` or `png` Input_File as one Page.
5. WHILE a Document_Model built from photos has fewer Pages than the limit of Requirement 3.2, THE ReForge_App SHALL show an "Add another page" control. WHEN the user adds a `jpeg` or `png` file through that control, THE Document_Path SHALL append it as the Page whose page number is the current page count plus 1.
6. IF a file added with "Add another page" is larger than the limit of Requirement 3.1, fails to decode, or has a Source_Kind other than `jpeg` or `png`, THEN THE ReForge_App SHALL refuse it with the matching message of Requirement 2.5, 3.1 or 3.6 and leave the existing Pages unchanged.

### Requirement 8: OCR engine hosting and loading

**Slice:** 1

**User Story:** As a user on a slow connection, I want to know what the app downloads and to be able to stop it, so that I am never stuck waiting without knowing why.

#### Acceptance Criteria

1. THE Worker SHALL serve all OCR_Assets from the ReForge_App's own origin, and THE ReForge_App SHALL load no OCR_Asset from a third-party origin at runtime.
2. THE ReForge_App SHALL load the OCR_Engine only when the first Page with Page_Text_Source `ocr` needs it, SHALL run at most one OCR_Worker at any time, and SHALL reuse that OCR_Worker for every later Page until the user cancels.
3. THE ReForge_App SHALL load only the language data of the OCR_Language in use.
4. THE ReForge_App SHALL run the OCR_Engine only inside the OCR_Worker, so that the main thread stays responsive to input during recognition and the cancel control of criterion 8.6 responds within 1 second while a Page is being recognised.
5. WHEN the OCR_Assets are not yet in the browser cache, THE ReForge_App SHALL, before any download, state that a one-time download is needed and its size in megabytes as the design measures it, SHALL start the download only after the user presses a continue control, and SHALL show progress as megabytes downloaded of the total.
6. WHILE OCR_Assets are downloading or a Page is being recognised, THE ReForge_App SHALL show a cancel control. WHEN the user presses cancel, THE ReForge_App SHALL end the OCR_Worker and the download within 2 seconds, discard the Document_Model, store no partially downloaded OCR_Asset as complete, return to the Entry_Screen, and send nothing.
7. WHILE a Page is being recognised, THE ReForge_App SHALL show progress that names the current page and the total ("Reading page 2 of 3").
8. THE browser caches that hold OCR_Assets SHALL hold only OCR_Assets and SHALL hold no page image, Text_Line, Label_Candidate or answer.
9. THE design SHALL record the measured download size of the OCR_Assets for each Validated_OCR_Language, the measured recognition time per clean page on a mid-range phone and on a desktop, and the worst-case first-use time on a throttled slow mobile connection. The planning estimate is 5 to 30 seconds per clean page on a mid-range phone.
10. IF the OCR_Assets cannot be loaded, or a download shows no progress for 30 seconds, THEN THE ReForge_App SHALL tell the user in the Interface_Language that the reading tool could not be loaded, offer a retry control and a control that returns to the Entry_Screen, keep the Pages already read, and send nothing. A stalled download SHALL continue until the user chooses one of these controls.

### Requirement 9: OCR languages and quality

**Slice:** 1, except criterion 9.6 (Slice 2)

**User Story:** As a user, I want the app to read the language my form is written in and tell me honestly when it could not read it well, so that I can take a better photo or check the labels.

#### Acceptance Criteria

1. THE ReForge_App SHALL offer an OCR_Language to users only after it passes the OCR_Validation_Bar: across all clean-photo fixtures of Requirement 25 in that language, at least 90% of the expected labels each match one Text_Line with a character error rate of 10% or less, and the design records the measured results. THE design SHALL record whether Malay passes; Slice 1 offers English, plus Malay only if Malay passes.
2. WHEN the Document_Path first needs OCR for an Input_File, and before any OCR language data loads, THE ReForge_App SHALL ask the user which language the paper form is written in, listing the Validated_OCR_Languages by their native names and an "another language" choice, and SHALL use the chosen Validated_OCR_Language as both the OCR_Language and the initial Form_Language.
3. IF the user selects "another language", THEN THE ReForge_App SHALL say in plain words that the app cannot yet read printed forms in other languages, SHALL offer to try with one of the Validated_OCR_Languages or to stop, and SHALL start no OCR and send nothing until the user chooses.
4. WHEN OCR of a Page finishes with fewer recognised words than the minimum set by the design (starting value 10), or with a mean Text_Line confidence below the threshold set by the design (starting value 0.60), THE ReForge_App SHALL mark the Page a Low_Quality_Page and show Retake_Advice: one plain sentence (for example "We could not read this photo. Take it again in good light, holding the phone straight above the form."), a retake control that replaces only that Page, the rotate control, and a control to continue with what was read.
5. WHEN a Label_Candidate comes from an `ocr` Text_Line with a confidence below the threshold set by the design (starting value 0.60), or from a Low_Quality_Page the user continued with, THE ReForge_App SHALL mark that Label_Candidate on the Label_Review and on its question step with a visible "check this yourself" notice in the Interface_Language, shown as text and an icon and not by colour alone.
6. WHERE additional OCR languages are delivered (Slice 2), THE ReForge_App SHALL offer each additional OCR_Language only after it passes the OCR_Validation_Bar, and THE design SHALL record per-language quality, including Simplified Chinese, Traditional Chinese and Tamil, with the warning text shown for each.
7. THE ReForge_App SHALL state in visible text, on the language question of criterion 9.2, that handwriting cannot be read.

### Requirement 10: Three separate language settings

**Slice:** 1

**User Story:** As a user who reads Chinese but holds a Malay form, I want the app to keep my reading language, the form's language and the reading tool's language apart, so that each one is right.

#### Acceptance Criteria

1. THE ReForge_App SHALL keep the Interface_Language, the Form_Language and the OCR_Language as three separate settings in the session state, so that changing any one of them leaves the other two unchanged.
2. WHEN the user changes the Interface_Language, THE ReForge_App SHALL keep the Form_Language, the OCR_Language, the Document_Model, the Kept_Labels with their edits, every answer and the current wizard step unchanged, and SHALL run no new OCR.
3. THE ReForge_App SHALL set the `lang` attribute of every element that shows Label_Candidate or Kept_Label text to the BCP 47 tag of the OCR_Language for `ocr` Pages and of the Form_Language for `text-layer` Pages. IF the Form_Language is not yet set, THEN THE ReForge_App SHALL use `und` for those `text-layer` elements and SHALL update the attribute when the Form_Language is set.
4. IF the Label_Analysis reply carries a detected Form_Language or Form_Country with a confidence below the existing `formbridge-pdf` threshold, THEN THE ReForge_App SHALL ask the user to confirm it on the existing confirmation screen before the first question.
5. WHEN Original_Label_Mode starts and no Form_Country has been chosen, THE ReForge_App SHALL ask the user to choose the Form_Country before the first question, offering the delivered Country_Packs and a "none of these" choice that selects the `universal` pack.
6. WHEN Original_Label_Mode starts and no Form_Language is set, THE ReForge_App SHALL ask the user to choose the Form_Language from the Language_Registry before the first question.

### Requirement 11: Label classification, fail-closed

**Slice:** 1

**User Story:** As a user with a form that already has my details on it, I want the app to send only text that looks like a printed label, so that my details stay on my device.

#### Acceptance Criteria

1. THE Label_Classifier SHALL assign every Text_Line exactly one Label_Class, using only the Text_Line's text, its box, its confidence and the boxes of nearby Text_Lines and Answer_Areas on the same Page, with no network request, and SHALL be deterministic, so that the same input always yields the same Label_Class.
2. THE Label_Classifier SHALL assign `value-like` to every Text_Line, or Text_Line part, that matches any of the following rules, taking the phone, ID, email and date patterns from the delivered Country_Pack modules. These rules, together with criteria 11.9 and 11.10, SHALL take precedence over criteria 11.3 and 11.4.
   - It contains a run of 4 or more digits in any script, including ASCII, full-width and Tamil digits.
   - It matches an email address pattern.
   - It matches a phone number pattern of any delivered Country_Pack or the international pattern.
   - It matches an ID pattern of any delivered Country_Pack, including the Malaysian IC with or without separators and the US SSN.
   - It matches a date pattern that any delivered Country_Pack accepts.
   - It lies inside an Answer_Area.
   - It is the text after a label-ending colon on the same Text_Line.
3. THE Label_Classifier SHALL assign `likely-label` only to a Text_Line that is not `value-like`, whose trimmed length is between 1 and the maximum the design sets (starting at 60 characters), and that ends like a prompt, meaning it ends with a colon or a question mark, or is followed on its right or below by an Answer_Area, as the design defines.
4. THE Label_Classifier SHALL assign `ambiguous` to every Text_Line that is neither `value-like` nor `likely-label`, including headings, instructions and lines it cannot classify.
5. WHEN a Text_Line contains a label-ending colon followed by more text, THE Label_Classifier SHALL classify the part after the colon as `value-like`, and SHALL classify the part before the colon by criteria 11.2 to 11.4 as that Text_Line's possible Label_Candidate.
6. IF the Label_Classifier throws or returns a result that fails its own schema check for a Page, THEN THE Document_Model SHALL hold no Label_Candidate from that Page, so that no Text_Line of that Page is selectable on the Label_Review, THE Label_Review SHALL show a plain notice in the Interface_Language that the labels of that page could not be checked, the other Pages SHALL be unaffected, and THE Label_Analysis_Request SHALL carry no text from that Page.
7. FOR ALL Text_Lines that contain a Canary_Value shaped as an ID number, a phone number, an email address, a date or a run of 4 or more digits, at any position in the line and with or without label text, THE Label_Classifier SHALL produce no Label_Candidate whose text contains the Canary_Value.
8. THE design SHALL list every rule of this requirement with its exact pattern, and THE test suite SHALL test each rule with property tests and with the prefilled fixtures of Requirement 25.
9. IF a `value-like` part of a Text_Line is not separated from the rest of the line by a label-ending colon or an Answer_Area boundary, THEN THE Label_Classifier SHALL assign `value-like` to the whole Text_Line.
10. IF a Text_Line is empty or contains only whitespace or punctuation, THEN THE Label_Classifier SHALL assign `value-like` to that Text_Line, and THE Label_Review SHALL not list it.

### Requirement 12: Label review with page crops

**Slice:** 1

**User Story:** As a user, I want to see exactly which words will be sent, next to the part of my form they came from, so that I decide what leaves my device.

#### Acceptance Criteria

1. WHEN classification of every Page is complete, THE ReForge_App SHALL show the Label_Review before any Label_Analysis_Request is sent.
2. THE Label_Review SHALL list every Label_Candidate in the order of Requirement 4.6, each with its text, its page number, and its Page_Crop beside it, and SHALL list no Text_Line or Text_Line part that the Label_Classifier classified `value-like`.
3. THE Label_Review SHALL show `likely-label` candidates selected for sending and `ambiguous` candidates unselected, each with a visible selection control and its state stated in text.
4. THE Label_Review SHALL let the user remove any candidate from the send list, add an unselected candidate to the send list, and correct a candidate's text up to the maximum Kept_Label length of the Label_Analysis_Request schema (Requirement 13.2), with each control operable by keyboard and at least 44 by 44 CSS px.
5. WHEN the user corrects a candidate's text, THE Label_Classifier SHALL classify the corrected text again. IF the corrected text is `value-like`, THEN THE Label_Review SHALL remove that candidate from the send list, explain in plain words that text like a number, email or ID number is not sent, and refuse to add that candidate back to the send list while its text stays `value-like`.
6. THE Label_Review SHALL show, in plain words in the Interface_Language, a heading stating that only the selected words will be sent to the AI service to write the questions, and a count of the selected items that updates on every change and is announced in an `aria-live="polite"` region.
7. WHEN the user presses the Page_Crop of a candidate, THE ReForge_App SHALL show that crop enlarged in a dialog that the user can zoom, that keeps focus inside it while open, and that returns focus to the crop when closed.
8. THE Label_Review SHALL offer a control that continues with no AI, which starts Original_Label_Mode with the selected candidates and sends nothing.
9. WHEN the user confirms the Label_Review, THE ReForge_App SHALL fix the send list as the Kept_Labels, and the Label_Analysis_Request SHALL carry exactly the Kept_Label texts shown on the Label_Review at that moment.
10. IF the Document_Model has no Label_Candidate, THEN THE ReForge_App SHALL tell the user in plain words that no labels were found, and SHALL offer the retake control, the rotate control for photos, and the option to try another file.
11. IF the user confirms the Label_Review or presses the control of criterion 12.8 with no candidate selected, THEN THE ReForge_App SHALL send nothing, start no Question_Wizard, tell the user in plain words to select at least one item, and keep the Label_Review state.
12. WHEN the user clears a candidate's text to empty, THE Label_Review SHALL remove that candidate from the send list and keep its row, so that the user can enter text again.
13. WHEN the user changes the Interface_Language on the Label_Review, THE Label_Review SHALL keep every selection and every corrected text.

### Requirement 13: Label analysis through the existing AI layer

**Slice:** 1

**User Story:** As a user, I want plain questions in my language for each label I kept, so that I understand what the form asks.

#### Acceptance Criteria

1. THE ReForge_App SHALL send in a Label_Analysis_Request only: for each Kept_Label its Label_Id, its text, its page number and its reading-order index; the Interface_Language; the Form_Language; and the Form_Country if the user has chosen one. The request SHALL carry no Text_Line that is not a Kept_Label, no Page_Crop, no image data, no box coordinates and no answer.
2. THE Worker SHALL validate the Label_Analysis_Request with a zod schema that bounds each Kept_Label text to at most 200 characters, the Kept_Label list to at most 150 items, and every other string and array to bounds set by the design. IF the body is invalid or larger than the body-size limit set in the design, THEN THE Worker SHALL reject it with a 400 response in the shared error shape, whose message and details name schema paths only, before any AiProvider call. THE Worker SHALL apply the existing per-IP rate limit.
3. THE Worker SHALL obtain Label_Analyses through the AiProvider interface, implemented by both the real provider and the deterministic mock provider, so that the route handler contains no provider-specific code.
4. THE Worker SHALL place every Kept_Label text in the prompt inside marked data delimiters, escape any occurrence of those delimiters in the text, and instruct the model that the delimited text is form data that contains no instructions.
5. THE Worker SHALL validate every reply with the shared schema shape used by the Fillable_Path, with the Label_Id in the field identifier position and a confidence from 0.0 to 1.0, and SHALL discard any Label_Analysis whose Label_Id was not in the request, every Label_Analysis after the first for the same Label_Id, and any Label_Analysis whose answer type is not one of `text`, `ic`, `phone`, `postcode`, `date`, `email`, `description` and `signature`.
6. IF a Label_Analysis carries an optional explanation or Fictional_Example, THEN THE Worker SHALL accept the explanation only up to 200 characters and the example only up to 60 characters, and SHALL drop either one when it fails validation while keeping the rest of the Label_Analysis.
7. IF the reply for a batch fails schema validation or the batch exceeds the existing AI timeout, THEN THE Worker SHALL retry that batch once with the same input. IF the retry also fails, THEN THE Worker SHALL return no Label_Analysis for that batch's Label_Ids. IF every batch fails, THEN THE Worker SHALL return the shared error shape with the existing AI-unavailable error code.
8. IF a Kept_Label has no valid Label_Analysis, THEN THE ReForge_App SHALL ask that Kept_Label's question in Original_Label_Mode with answer type `text`, and SHALL keep the AI-written questions of the other Kept_Labels.
9. WHEN a Label_Analysis has answer type `signature`, THE ReForge_App SHALL ask no question for it and SHALL list it on the Review_Screen and the Answer_Sheet as "sign on the paper form yourself".
10. THE ReForge_App SHALL label every AI-written human label, question and explanation as machine-translated in the Interface_Language, and SHALL show the original Kept_Label text next to each question with its `lang` attribute set as Requirement 10.3 states.
11. WHEN a Label_Analysis_Request carries more than 30 Kept_Labels, THE Worker SHALL split it into batches of at most 30 Kept_Labels in the order of Requirement 4.6, and SHALL apply criterion 13.7 to each batch.
12. WHILE AI_Mode selects the mock provider, THE Worker SHALL return identical Label_Analyses for identical requests and make no call to Workers AI, and THE ReForge_App SHALL show the existing Demo mode banner.
13. THE Worker SHALL log Label_Analysis_Requests with only the fields the Privacy_Steering allows and with no Kept_Label text, Label_Analysis text, prompt or model reply, and THE test suite SHALL include a Canary_Value test on the Worker logs and error messages. Requirements 24.3 to 24.5 cover the matching Privacy_Steering and Privacy_Notice changes.

### Requirement 14: Working without AI or network

**Slice:** 1

**User Story:** As a user whose connection drops or whose day's AI quota is used up, I want to still finish my answers, so that the app never leaves me stuck.

#### Acceptance Criteria

1. IF every batch of the Label_Analysis_Request fails with a network error, the existing request timeout, a quota or rate-limit error, or the AI-unavailable error, THEN THE ReForge_App SHALL tell the user in plain words that the questions will use the form's own words, and SHALL continue in Original_Label_Mode with every Kept_Label and every answer kept.
2. WHILE Original_Label_Mode is active, THE Question_Wizard SHALL ask each question as a fixed sentence from the locale files that quotes the Kept_Label text unchanged, with that quoted text marked with its `lang` attribute, and SHALL use answer type `text` for every Kept_Label.
3. WHILE Original_Label_Mode is active, THE ReForge_App SHALL make no network request from the first question step to the display of the Answer_Sheet, so that the user can complete every question, the Review_Screen and the Answer_Sheet with the network disconnected.
4. WHILE Original_Label_Mode is active, THE ReForge_App SHALL show on every question step a notice in the Interface_Language that the questions use the form's own words and were not explained by AI.
5. IF at least one Page but not every Page needs OCR, the OCR_Assets are not in the browser cache and the network is unavailable, THEN THE ReForge_App SHALL tell the user that the reading tool needs a connection the first time, list the page numbers that cannot be read, offer a retry control, and let the user continue to the Label_Review with the Label_Candidates of the `text-layer` Pages.
6. IF every Page needs OCR, the OCR_Assets are not in the browser cache and the network is unavailable, THEN THE ReForge_App SHALL tell the user that the reading tool needs a connection the first time, offer a retry control and a control that returns to the Entry_Screen, and send nothing.

### Requirement 15: Guided questions for users with little computer experience

**Slice:** 1

**User Story:** As an older user, I want one simple question per screen with an example, help and a way back, so that I never feel lost.

#### Acceptance Criteria

1. THE Question_Wizard SHALL show exactly one question per screen, with a progress line in the Interface_Language that states the current question number and the total ("Question 3 of 12") in text, where the total counts every Kept_Label except those with answer type `signature`.
2. THE Question_Wizard SHALL show a Back control of at least 44 by 44 CSS px on every question step after the first, always visible without scrolling at a 360 by 640 CSS px viewport, that returns to the previous step with its answer kept.
3. WHEN the answer on a step differs from the answer the step held when the user arrived at it, THE Question_Wizard SHALL show an undo control that stays until the user leaves the step. WHEN the user presses undo, THE Question_Wizard SHALL restore the arrival answer and hide the undo control.
4. THE Question_Wizard SHALL show a Fictional_Example on every question step: the Label_Analysis example when one passed validation, otherwise a fixed example for the answer type from the locale files. Each Fictional_Example SHALL carry a visible label in the Interface_Language stating that it is an example and not real.
5. THE ReForge_App SHALL never insert a Fictional_Example or any Document_Model text into an answer, and the answer input SHALL start empty unless the user answered the step earlier in the session, in which case the input SHALL show that answer.
6. THE Question_Wizard SHALL show an "I do not know" control on every question step. WHEN the user presses it, THE Question_Wizard SHALL show a plain-language explanation of the field (the Label_Analysis explanation when one passed validation, otherwise a fixed text for the answer type from the locale files), a skip control, and a hint that the user can ask someone they trust to help. The hint SHALL send nothing anywhere and SHALL offer no sharing, messaging or contact feature.
7. WHEN the user skips a question, THE ReForge_App SHALL bypass validation for that step, store no answer, mark the step as skipped, show it as skipped on the Review_Screen with a control that returns to that step, and show it as skipped on the Answer_Sheet.
8. THE Question_Wizard SHALL impose no time limit on any step, screen or session, and SHALL never discard answers because of inactivity.
9. WHEN the user presses the Translation_Button on a description question, THE ReForge_App SHALL send only the text the user typed in that answer box, once, and SHALL never send text taken from the Document_Model through the Translation_Button.

### Requirement 16: Validation reuse

**Slice:** 1

**User Story:** As a user, I want my answers checked the same way as on fillable forms, so that mistakes are caught before I copy them onto the paper.

#### Acceptance Criteria

1. THE Question_Wizard SHALL validate every Document_Path answer only through the existing Country_Pack entry point `validateAnswer` with the confirmed Form_Country's pack, with no separate copy of any IC, phone, postcode, email, date or required-field rule.
2. WHEN the user submits an answer to a Kept_Label with answer type `text` to which no Country_Pack rule applies, THE Question_Wizard SHALL accept the answer only if it has 1 to 200 Unicode code points after trimming. WHEN the user submits an answer of type `description`, THE Question_Wizard SHALL accept the answer only if it has 1 to 2000 Unicode code points after trimming.
3. IF an answer fails Country_Pack validation, is empty, or exceeds its limit, THEN THE Question_Wizard SHALL keep the user on the step with the answer in the input as typed, show the Country_Pack message or the limit message in the Interface_Language, link it with `aria-describedby`, announce it through an `aria-live="polite"` region, and set `aria-invalid="true"` on the input, and the message SHALL contain no part of the answer.
4. THE ReForge_App SHALL write every answer on the Review_Screen and the Answer_Sheet as the text the user entered after Country_Pack normalization, with no automatic translation, except a description answer whose translation the user approved through the Translation_Button.
5. THE test suite SHALL include a static test that fails when any Document_Path module defines its own IC, phone, postcode, email or date pattern, or imports any validation function other than the Country_Pack entry point `validateAnswer`. The Label_Classifier MAY import the pattern exports of the Country_Pack modules for Requirement 11.2.

### Requirement 17: Read-aloud with local voices only

**Slice:** 1

**User Story:** As a user who finds reading hard, I want the app to read the question to me, so that I can follow along.

#### Acceptance Criteria

1. WHERE the browser reports a Local_Voice whose language tag matches the Interface_Language (the same primary language subtag; for Chinese, `zh-Hans` matches only `zh-CN` and `zh-SG`, and `zh-Hant` matches only `zh-TW` and `zh-HK`), THE Question_Wizard SHALL show a Read_Aloud control on every question step that speaks only Interface_Language text: the question and, when shown, the explanation.
2. IF the browser offers no `speechSynthesis`, or reports no matching Local_Voice when the step is shown or after any `voiceschanged` event, THEN THE Question_Wizard SHALL hide the Read_Aloud control.
3. THE ReForge_App SHALL speak only through the browser's built-in speech synthesis with a Local_Voice, and SHALL send no text to any remote speech service.
4. WHEN the user presses the Read_Aloud control while speech is playing, moves to another step, leaves the Question_Wizard or changes the Interface_Language, THE ReForge_App SHALL stop the speech within 500 ms.
5. THE Read_Aloud control SHALL be a native button, operable by keyboard, at least 44 by 44 CSS px, with a visible text label in the Interface_Language that states whether it starts or stops reading.

### Requirement 18: Review screen for the Document_Path

**Slice:** 1

**User Story:** As a user, I want to check all my answers before I print them, so that I can fix mistakes.

#### Acceptance Criteria

1. WHEN the user completes or skips the last question, THE Review_Screen SHALL list every Kept_Label in the order of Requirement 4.6 with its original text (with `lang` set as Requirement 10.3 states), its page number, its Page_Crop, the question asked, the answer and exactly one status: `filled` (a valid answer is stored), `skipped` (as Requirement 15.7 states) or `sign yourself` (answer type `signature`).
2. THE Review_Screen SHALL give every row an edit control that opens that step with the stored answer, also for a skipped step, validates the answer again as Requirement 16 states, and returns to that row after validation.
3. WHEN the user presses the control labelled with the meaning "Make my answer sheet", THE Review_Screen SHALL show the Answer_Sheet. WHILE any answer awaits validation again, THE Review_Screen SHALL disable that control and say why in the Interface_Language.
4. THE Review_Screen SHALL show the Privacy_Notice in the Interface_Language, stating that the photo or file and the answers stayed in the browser and that only the Kept_Labels and any description the user chose to translate went to the AI service, or, when the user continued with no AI through Requirement 12.8, that nothing was sent.

### Requirement 19: Answer sheet

**Slice:** 1, except criterion 19.8 (Slice 2)

**User Story:** As a user with a paper form, I want a large-print sheet of my answers, so that I can copy them onto the form or show them at the counter.

#### Acceptance Criteria

1. THE Answer_Sheet SHALL list, for each Kept_Label in the order of Requirement 4.6, the original label text with its `lang` attribute set as Requirement 10.3 states, its page number, and either the answer as stored after normalization or the status `skipped` or `sign yourself`, shown as "sign on the paper form yourself".
2. THE Answer_Sheet SHALL contain a Clerk_Summary with `lang` set to the Form_Language, stating that the person prepared these answers with help from the app and that the sheet is not an official form, and listing each label with its answer. Each fixed string of the Clerk_Summary SHALL come from the Form_Language locale file, or from the English locale file for any key the Form_Language file lacks, in which case that string SHALL carry `lang="en"`.
3. THE Answer_Sheet SHALL render body text at no less than 20 CSS px on screen and 14 pt in print, with a contrast ratio of at least 7:1, one label and answer per row, and long answers wrapped in full and never truncated.
4. WHEN a description answer was translated with the Translation_Button and the user accepted the translation, THE Answer_Sheet SHALL mark that answer as machine-translated in the Interface_Language and in the Form_Language.
5. THE ReForge_App SHALL generate the Answer_Sheet in the browser, SHALL offer a Print control that opens the browser print dialog, and SHALL start a print, share or download only when the user presses its control.
6. THE ReForge_App SHALL offer a download of the Answer_Sheet as a PDF generated in the browser for Form_Languages written in Latin script, with the existing open-licensed Noto font embedded. IF a Form_Language's script is not supported for PDF output in the delivered slice, THEN THE ReForge_App SHALL offer Print and Share only and say so in the Interface_Language.
7. THE Answer_Sheet page SHALL use semantic HTML (a heading, and a table or description list with headers), set `lang` on each element whose language differs from the page, and pass the axe checks of Requirement 23.
8. WHERE the Overlay is delivered (Slice 2), THE ReForge_App SHALL let the user place each answer on the page image at a position the user chooses, show a preview before any download, and make no claim that answer boxes were found automatically.
9. WHERE the browser supports the Web Share API with files, THE ReForge_App SHALL offer a Share control for the Answer_Sheet.
10. WHEN the user edits an answer after the Answer_Sheet was generated, THE ReForge_App SHALL rebuild the Answer_Sheet before the next print, share or download.
11. WHILE the ReForge_App generates, prints, shares or downloads the Answer_Sheet, THE ReForge_App SHALL make no network request that carries an answer or Kept_Label text.

### Requirement 20: Session memory and leaving the page

**Slice:** 1

**User Story:** As a user, I want my answers kept while I move around the app and a warning before I lose them, so that I do not lose my work by accident.

#### Acceptance Criteria

1. THE ReForge_App SHALL keep the Document_Model and every answer in memory across in-app Back and forward navigation for the current page load.
2. THE ReForge_App SHALL write no Input_File bytes, Document_Model, Kept_Label, answer, Text_Line, Label_Candidate, Page_Crop or Working_Image to localStorage, sessionStorage, IndexedDB, cookies, the Cache Storage API, any service worker cache, the page URL or the history state. Caching OCR_Assets as Requirement 8.8 states remains allowed.
3. WHILE at least one answer is non-empty or a Document_Model is loaded, THE ReForge_App SHALL keep a `beforeunload` handler registered that requests the browser's leave-page warning, and SHALL remove the handler within the same page load when neither condition holds.
4. THE ReForge_App SHALL state on the first question step, in plain words in the Interface_Language, that refreshing or closing the page loses the answers.
5. THE ReForge_App SHALL send no answer to any destination, including telemetry, error reports and logs, except the single Translation_Button request of Requirement 15.9.
6. THE test suite SHALL include a Canary_Value test that follows a Canary_Value printed on the Input_File and a Canary_Value typed as an answer from the Input_File to the Answer_Sheet and proves criteria 20.2 and 20.5, as part of the canary tests of Requirement 24.7.

### Requirement 21: Additional input formats

**Slice:** 2

**User Story:** As a user with a WebP image, an iPhone photo, a vector file, a Word document or a text file, I want the app to read it, so that I do not need to convert it first.

#### Acceptance Criteria

1. WHERE WebP input is delivered (Slice 2), WHEN the File_Sniffer assigns `webp`, THE Document_Path SHALL decode the Input_File to a Working_Image in the browser within the pixel limit of Requirement 3.3 and treat it as Requirement 7 states. IF decoding fails, THEN THE ReForge_App SHALL respond as Requirement 3.6 states.
2. WHERE HEIC input is delivered (Slice 2), THE ReForge_App SHALL load the HEIC converter from its own origin only when the File_Sniffer assigns `heic`, apply the EXIF orientation exactly once, apply the pixel limit of Requirement 3.3, respond to a converter load failure in the same way as Requirement 8.10 and to a decode failure as Requirement 3.6 states. THE test suite SHALL include at least two iPhone photo files of synthetic forms made for this project.
3. WHERE SVG input is delivered (Slice 2), THE Document_Path SHALL remove every script, event handler, external reference and `foreignObject` element from the SVG before rasterising it, rasterise it within the pixel limit of Requirement 3.3, and make no network request while doing so.
4. WHERE DOCX input is delivered (Slice 2), THE Document_Path SHALL extract paragraph and table text from a `docx` Input_File in document order, pass it through the shared Label_Review, Question_Wizard and Answer_Sheet, and never modify the Word file. IF the file exceeds the design's limits on entry count, uncompressed size or compression ratio, THEN THE Document_Path SHALL stop reading and THE ReForge_App SHALL respond as Requirement 3.6 states.
5. WHERE TXT input is delivered (Slice 2), THE Document_Path SHALL read a `txt` Input_File as UTF-8 and treat each non-empty line as a Text_Line on one Page, up to the line limit set by the design. IF the file is not valid UTF-8, THEN THE ReForge_App SHALL respond as Requirement 3.6 states.
6. WHERE an additional format is delivered (Slice 2), THE File_Sniffer property tests of Requirement 25 SHALL cover that format's malformed and oversized cases.

### Requirement 22: Photo quality checks, crop and advanced recovery

**Slice:** 2

**User Story:** As a user who takes a poor photo, I want one simple instruction that tells me how to take a better one, so that I succeed on the next try.

#### Acceptance Criteria

1. WHERE automated photo-quality checks are delivered (Slice 2), WHEN the Document_Path decodes a photo, THE ReForge_App SHALL check it locally for blur, darkness, glare and small text before OCR against thresholds set by the design, SHALL show at most one instruction at a time (for example "Move closer", "Hold still", "Move away from the light"), and SHALL let the user continue without retaking.
2. WHERE crop is delivered (Slice 2), THE ReForge_App SHALL let the user crop a page image before OCR, with handles of at least 44 by 44 CSS px that the arrow keys move by a step set by the design. WHEN the user applies a crop, THE Document_Path SHALL recognise that Page again.
3. WHERE advanced recovery is delivered (Slice 2), THE ReForge_App SHALL let the user read a single Page again with another Validated_OCR_Language or move a Page to another position, keeping the answers of Kept_Labels whose Label_Id and text are unchanged.
4. WHERE advanced recovery is delivered (Slice 2), IF reading a Page again or moving a Page would discard answers, THEN THE ReForge_App SHALL state how many answers would be discarded and ask the user to confirm before proceeding.
5. WHERE automated photo-quality checks, crop or advanced recovery are delivered (Slice 2), THE ReForge_App SHALL run them in the browser and send no image, measurement or result anywhere, and THE test suite SHALL include a Canary_Value test that proves it.

### Requirement 23: Accessibility for users with little computer experience

**Slice:** 1

**User Story:** As an older user or a user of assistive technology, I want every new screen to work with large text, a keyboard and a screen reader, so that the app removes barriers instead of adding them.

#### Acceptance Criteria

1. THE ReForge_App SHALL give every primary control on the Entry_Screen, the language question, the Label_Review, the Question_Wizard, the Review_Screen and the Answer_Sheet a target of at least 44 by 44 CSS px, and every other pointer target at least 24 by 24 CSS px.
2. THE ReForge_App SHALL offer the existing larger-text option on every new screen, raising body text to at least 20 CSS px, and a high-contrast option that gives all text a contrast ratio of at least 7:1.
3. WHEN the screen or the wizard step changes, THE ReForge_App SHALL move focus to the heading of the new content.
4. THE ReForge_App SHALL make every new screen operable with the keyboard alone in reading order, with no keyboard trap and a visible focus indicator at least 2 CSS px thick with 3:1 contrast.
5. THE ReForge_App SHALL show every status (`likely-label` selected, `ambiguous` unselected, removed as `value-like`, "check this yourself", Low_Quality_Page, `skipped`, `sign yourself`, Original_Label_Mode) with text and an icon, so that no status is carried by colour alone.
6. THE ReForge_App SHALL give every Page_Crop a text alternative that contains the Label_Candidate text and its page number.
7. THE new screens SHALL show all content without horizontal scrolling at a 360 px viewport width and at 200% zoom on a 1280 px viewport, and SHALL respect `prefers-reduced-motion`.
8. WHILE AI_Mode selects the mock provider, THE Playwright suite SHALL run axe with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, in `en` and `zh-Hans`, on the Entry_Screen, the refusal message, the OCR download and progress screen, the language question, the Retake_Advice screen, the Label_Review, the enlarged Page_Crop dialog, a question step with the "I do not know" help open, a question step in Original_Label_Mode, the Review_Screen and the Answer_Sheet, and SHALL fail on any reported violation of any impact level.
9. THE manual accessibility checklist at `docs/accessibility-checklist.md` SHALL gain entries, each with a pass or fail result and the date checked, for a keyboard-only run of scenario 2, a screen-reader pass on the Label_Review and the Question_Wizard, a real-phone run of scenario 10, Read_Aloud on a phone with a Local_Voice, a printed Answer_Sheet, and a run on a throttled slow mobile connection.
10. THE ReForge_App SHALL take every new UI string from the locale files, and THE locale file of every Core_Language SHALL contain every new key.
11. WHILE OCR_Assets are downloading or a Page is being recognised, THE ReForge_App SHALL announce progress in an `aria-live="polite"` region at most once per page change and once per 25% of the download.
12. WHEN the user presses Escape while the enlarged Page_Crop dialog of Requirement 12.7 is open, THE ReForge_App SHALL close the dialog and return focus to the Page_Crop.

### Requirement 24: Privacy data path, steering and notices

**Slice:** 1

**User Story:** As a user, I want the app to tell me exactly what leaves my device and to do only that, so that I can trust it with personal forms.

#### Acceptance Criteria

1. THE ReForge_App SHALL send from the Document_Path to the Worker only the Label_Analysis_Request of Requirement 13.1, the Translation_Button request of Requirement 15.9, and GET requests for static assets and OCR_Assets that carry no document-derived or answer data in their URL, headers or body. THE Worker SHALL send to the AI service only Kept_Label text, the request's language and country settings, the user-requested description text, and fixed prompt text.
2. THE ReForge_App SHALL never send an Input_File, its bytes, a base64 copy, a Working_Image, a Page_Crop or any rendered image of a Page to any destination.
3. THE Worker SHALL log Label_Analysis_Requests, on success and on error, with only the items the Privacy_Steering allows (request id, route, status, duration, error code, AI mode, model, attempts, token counts, neurons and cache flag), and with no Kept_Label text, prompt, model reply or request body.
4. THE Privacy_Steering SHALL be updated in the same change that adds the Label_Analysis_Request, so that its list of data that may reach the Worker and the AI service includes Kept_Labels (Label_Candidate text the user kept on the Label_Review, with its Label_Id, page number and reading-order index), and so that its "What stays in the browser" list includes the Input_File of every Source_Kind, decoded images, Page_Crops and every Text_Line that is not a Kept_Label.
5. THE Privacy_Notice SHALL be updated in every Core_Language locale file in the same change, so that it states in plain words: your file, your photos and your answers stay on this device; the words you keep on the label review are sent to the AI service to write the questions; a description answer you choose to translate is also sent. THE Privacy_Notice SHALL state nothing that the delivered code does not do.
6. THE ReForge_App SHALL show the Privacy_Notice on the Entry_Screen, on the Label_Review and on the Review_Screen.
7. THE test suite SHALL include canary tests with Canary_Values printed on a synthetic prefilled document (a name, an ID number, a phone number, an email address and a free-text sentence) and Canary_Values typed as answers. The tests SHALL run the flow of scenario 8 twice, once through the AI path and once in Original_Label_Mode, and SHALL prove that no Canary_Value appears in any request body, request URL or request header sent by the browser, in any Worker log entry, in any prompt passed to the AiProvider, in any error response, or in any browser storage listed in Requirement 20.2, except a typed description Canary_Value in the one Translation_Button request after the press.
8. THE README SHALL state, in the same wording as the Privacy_Notice, what leaves the browser on the Document_Path, and SHALL make no claim of universal privacy.
9. WHILE the Document_Path is active, THE ReForge_App SHALL make no network request to any origin other than its own.

### Requirement 25: Fixtures and core-logic tests

**Slice:** 1, except criterion 25.6 (Slice 2)

**User Story:** As the developer, I want synthetic fixtures and property tests for the new logic, so that the label rules, the file recognition and the model invariants are checked on every change.

#### Acceptance Criteria

1. THE repository SHALL contain a script that generates synthetic fixtures with no real names, organisations or personal data: a clean printed English form and a clean printed Malay form as JPEG and PNG photos; a rotated photo with and without an EXIF orientation tag; a glary or blurred photo; a PDF without fields that mixes text pages and scanned pages; a 6-page PDF without fields; a prefilled sensitive form carrying the Canary_Values of Requirement 24.7, including one value written after a label-ending colon; an RTF file and a legacy `.doc` file; a file one byte over the size limit; and malformed and truncated PDF, JPEG and PNG files. THE script SHALL write byte-identical fixtures when run twice with no arguments.
2. THE test suite SHALL include a fast-check property, run at least 100 times, showing that FOR ALL generated Text_Lines containing a value-like string (a run of 4 or more digits, an email address, a date, or a phone number or ID number of any delivered Country_Pack, placed anywhere in the line), and FOR ALL generated user selections and text corrections on the Label_Review, the Label_Analysis_Request contains no such string.
3. THE test suite SHALL include a fast-check property, run at least 100 times, showing that FOR ALL byte sequences from 0 to 65,536 bytes long, including truncated and mutated copies of valid fixture files, the File_Sniffer returns exactly one Source_Kind without throwing, and returns `fillable-pdf`, `pdf-without-fields`, `jpeg` or `png` only for inputs that carry the matching signature.
4. THE test suite SHALL include a fast-check property showing that FOR ALL generated Document_Models, every Text_Line box lies within its Page, reading-order indexes are unique per Page, Label_Ids are unique and stable across rebuilding, and Label_Candidates are ordered by page and reading order.
5. THE Playwright scenarios of Requirement 27 SHALL use a mock OCR result by default. Separate real-OCR tests SHALL run the real OCR_Engine on the clean English photo fixture, the rotated fixtures and the glary or blurred fixture, SHALL fail when the clean fixture's result falls below the OCR_Validation_Bar, SHALL assert that the glary or blurred fixture produces a Low_Quality_Page, and SHALL record real recognition timings in the design.
6. WHERE additional OCR languages are delivered (Slice 2), THE fixture script SHALL also generate Simplified Chinese, Traditional Chinese and Tamil printed forms.
7. THE test suite SHALL run every automated test in CI and in the default test command with the mock AiProvider and make no real AI call. Real AI calls SHALL run only in explicitly named scripts or Smoke_Tests that the developer runs on purpose with `AI_MODE=real`.

### Requirement 26: Tests with representative users

**Slice:** 1

**User Story:** As the developer, I want to watch real people with little computer experience use the app on a phone, so that I know the flow works for the people it is for.

#### Acceptance Criteria

1. THE Usability_Test_Record SHALL record sessions with at least three people who are aged 60 or over or who report that they rarely use apps or websites beyond calls and messaging, each completing scenario 2 on a phone with synthetic forms only and no personal data.
2. THE Usability_Test_Record SHALL record, per session, the date, the phone and browser, the Interface_Language, whether the person completed the Answer_Sheet without help from the observer, the time to complete in minutes and seconds from the Entry_Screen to the Answer_Sheet, every hesitation (a pause of more than 10 seconds or a question to the observer), every error with the screen where it happened, and the person's own comment.
3. THE Usability_Test_Record SHALL state the completion bar, at least two of three people completing scenario 2 without help from the observer, and whether it was met, with no rounding up of results.
4. THE design SHALL record any limit of Requirement 3 or threshold of Requirements 9 and 11 that was changed after these sessions, with the reason.
5. THE Usability_Test_Record SHALL count as help any instruction or gesture from the observer about the app, and SHALL identify participants by code only, with no name, contact detail, photo or recording.
6. IF the completion bar of criterion 26.3 is not met, THEN THE Usability_Test_Record SHALL list the changes made in response and the results of at least one further session.

### Requirement 27: Acceptance scenarios as tests

**Slice:** 1 for scenarios 1, 2, 3, 4 (generic advice), 5, 7, 8, 9 and 10; Slice 2 for scenario 6 and the specific advice of scenario 4

**User Story:** As a judge, I want each promised scenario to run as a test, so that the demo shows working behaviour.

#### Acceptance Criteria

1. THE Playwright suite SHALL run the existing fillable `MY` and `US` scenarios unchanged and pass (scenario 1).
2. THE Playwright suite SHALL run scenario 2 with the synthetic clean photo fixture and the mock AiProvider, through the Entry_Screen, the language question, the Label_Review, every question, the Review_Screen and the Answer_Sheet, and SHALL assert that a Page_Crop appears beside every Label_Candidate on the Label_Review and that the Answer_Sheet lists every Kept_Label with its answer.
3. THE Playwright suite SHALL run scenario 3 with the rotated fixtures and assert that the Label_Review shows the expected labels listed by the fixture script: for the EXIF-tagged fixture with zero rotate presses, and for the untagged fixture after exactly one rotate press.
4. THE Playwright suite SHALL run scenario 4 with the glary or blurred fixture and a mock low-quality OCR result, assert that the generic Retake_Advice appears, then retake with the clean fixture and reach the Label_Review. The real-OCR check of the glary or blurred fixture is part of Requirement 25.5.
5. THE Playwright suite SHALL run scenario 5 with the mixed PDF fixture and assert that each Page has the Page_Text_Source listed by the fixture script and that Label_Candidates appear in page order.
6. THE Playwright suite SHALL run scenario 7 twice, once with every Worker API request failing with a network error and once with a quota error, and SHALL assert each time that the Original_Label_Mode notice appears and that the user completes an Answer_Sheet.
7. THE Playwright suite SHALL run scenario 8 with the prefilled sensitive fixture, record every network request from page load to the Answer_Sheet, and assert the canary conditions of Requirement 24.7.
8. THE Playwright suite SHALL run scenario 9 with the RTF and legacy `.doc` fixtures and assert the refusal message and the photo suggestion of Requirement 2.5.
9. THE Playwright suite SHALL run scenario 2 at a 360 by 640 CSS px viewport with touch emulation and the Interface_Language `zh-Hans`, using only the two entry buttons and the wizard controls, as the automated part of scenario 10; THE Usability_Test_Record of Requirement 26 covers the human part.
10. WHERE additional OCR languages are delivered (Slice 2), THE Playwright suite SHALL run scenario 6 with the Chinese and Tamil fixtures and assert that the quality warnings appear.

### Requirement 28: Honest claims

**Slice:** 1

**User Story:** As a judge or user, I want the app and the README to say exactly what works, so that nobody is misled.

#### Acceptance Criteria

1. THE README and the Entry_Screen help text SHALL list the tested input kinds (fillable PDF, PDF without fields, JPEG and PNG photos and screenshots in Slice 1) and the Validated_OCR_Languages, and SHALL mark every other input kind and language as not supported. The Entry_Screen help text SHALL name the input kinds in the plain words of Requirement 1.2. THE test suite SHALL include a test that fails when the README's list of OCR languages differs from the Validated_OCR_Languages the app offers.
2. THE `en` locale strings and the README text about the Document_Path SHALL describe it with the wording "helps you prepare your answers" and SHALL not use the words "accepts anything", "any document", "accurate" or "compliant" about it, and THE test suite SHALL include a test that scans them for these phrases.
3. THE Entry_Screen, the language question of Requirement 9.2 and the README SHALL state that handwriting is not supported.
4. THE README SHALL list every library and language data file added by this spec, including the OCR_Engine and its language data, each with its name, version and licence, in the "Pre-existing code disclosure" section.

## Open decisions for the developer

1. **Malay OCR validation.** Slice 1 offers Malay only if it passes the OCR_Validation_Bar (Requirement 9.1). The bar itself (90% of labels with a character error rate of 10% or less on clean synthetic photos) is a starting proposal; confirm or change it.
2. **Answer_Sheet format.** This spec makes printable HTML the main output, with a downloadable PDF for Latin-script Form_Languages only in Slice 1 (Requirement 19.6). Decide whether the PDF download is needed in Slice 1, and whether CJK and Tamil PDF output moves to Slice 2 or reuses the existing CJK font work.
3. **Privacy_Steering wording.** Requirement 24.4 requires a change to `.kiro/steering/privacy.md` in the same change as the code. The exact new wording needs your approval, because the steering file says that any new data path needs a change to it first.
4. **Order relative to `accessforge-skeleton`.** Both specs change the Privacy_Steering, the Privacy_Notice strings in every locale file, the Worker route index and possibly `wrangler.jsonc` (static assets for OCR_Assets, and headers that allow the OCR_Engine's WebAssembly). Recommendation: finish `accessforge-skeleton` Slice 1 first, then start this spec, and make the shared-file changes in one task at the start of this spec. Confirm.
5. **Change to `formbridge-pdf` Requirement 1.3.** Requirement 2.4 replaces the "no interactive form fields" rejection with routing to the Document_Path. Decide whether `formbridge-pdf/requirements.md` gets a dated note pointing to this spec.
6. **Limits for a fillable PDF over 10 MB.** A fillable PDF keeps the existing 10 MB limit, while the Document_Path allows 15 MB. A fillable PDF between 10 MB and 15 MB is therefore refused rather than read as a document. Confirm this, or choose to route it to the Document_Path.
7. **AI explanation and example.** Requirement 13.6 adds an optional explanation and Fictional_Example to the Label_Analysis. Decide whether the Fillable_Path also asks for them. That would change its schema and require the precomputed fixture cache to be generated again, which Requirement 5.3 currently forbids.
8. **Instructions and headings as context.** Slice 1 sends only Kept_Labels. Some labels make sense only with a nearby instruction or section heading. Decide whether the user may keep `ambiguous` instruction lines as context items in Slice 2.
9. **Choice questions on paper forms.** Slice 1 asks every non-validated label as free text, so "Gender: Male / Female" is answered by typing. Decide whether option detection for printed choices belongs in Slice 2.
10. **Seven-day fit.** Slice 1 is large. If it does not fit, the proposed cut order is: the downloadable Answer_Sheet PDF (keep Print), "Add another page" for photos (Requirement 7.5), then Share.
11. **Slow-page notice.** Requirement 3.8 shows a "keep waiting" or "stop" notice after 60 seconds on one page and never stops processing automatically, to stay consistent with the no-timeout rule of Requirement 15.8. Requirement 8.10 treats a stalled download the same way. Confirm the 60-second and 30-second values and that no automatic stop is wanted.
12. **Classifier failure blocks a whole page.** Requirement 11.6 now fails closed per page: if the Label_Classifier fails on a page, no text from that page can be selected or sent, and the user sees a notice. The earlier behaviour (every line `ambiguous` and selectable) is gone. Confirm that losing a page's labels in this case is acceptable, given that the user can retake that page as a photo or continue with the other pages.
