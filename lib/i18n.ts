/**
 * Lightweight EN/HI dictionary for the public portal. Keys are semantic ids;
 * t(key) returns the string for the active language, falling back to English,
 * then to the key itself.
 */
export type Lang = "en" | "hi";

type Entry = { en: string; hi: string };

export const DICT: Record<string, Entry> = {
  // Government strip
  "gov.india": { en: "Government of India", hi: "भारत सरकार" },
  "gov.mop": { en: "Ministry of Power", hi: "विद्युत मंत्रालय" },
  "gov.skip": { en: "Skip to Main Content", hi: "मुख्य सामग्री पर जाएँ" },
  "gov.screenReader": { en: "Screen Reader Access", hi: "स्क्रीन रीडर एक्सेस" },

  // Masthead
  "brand.hi": { en: "ऊर्जा दक्षता ब्यूरो", hi: "ऊर्जा दक्षता ब्यूरो" },
  "brand.en": { en: "BUREAU OF ENERGY EFFICIENCY", hi: "ब्यूरो ऑफ़ एनर्जी एफिशिएंसी" },
  "brand.sub": {
    en: "A Statutory Body Under Ministry of Power, Government of India",
    hi: "विद्युत मंत्रालय, भारत सरकार के अधीन एक सांविधिक निकाय",
  },
  "search.placeholder": { en: "Search portal, circulars, schemes...", hi: "पोर्टल, परिपत्र, योजनाएँ खोजें..." },

  // Nav
  "nav.home": { en: "Home", hi: "मुख पृष्ठ" },
  "nav.about": { en: "About BEE", hi: "बीईई के बारे में" },
  "nav.programmes": { en: "Programmes & Schemes", hi: "कार्यक्रम एवं योजनाएँ" },
  "nav.directory": { en: "Directory", hi: "निर्देशिका" },
  "nav.verify": { en: "Verify", hi: "सत्यापन" },
  "nav.calculator": { en: "Calculator", hi: "कैलकुलेटर" },
  "nav.notifications": { en: "Notifications", hi: "अधिसूचनाएँ" },
  "nav.contact": { en: "Contact Us", hi: "संपर्क करें" },
  "cta.checkLabel": { en: "Check Star Label", hi: "स्टार लेबल जाँचें" },
  "cta.login": { en: "Login", hi: "लॉगिन" },
  "nav.menu": { en: "Menu", hi: "मेनू" },

  // Announcements ticker
  "ann.live": { en: "Live", hi: "लाइव" },
  "ann.label": { en: "Announcements:", hi: "घोषणाएँ:" },
  "ann.viewAll": { en: "View All", hi: "सभी देखें" },
  "ann.body": {
    en: "Public Notice for Electric Cooking • BEE invites registrations for the National Examination 2026 for Energy Managers, Energy Auditors and Energy Auditors (Building) • Seeking stakeholders' comments on provisionally eligible Accredited Carbon Verification Agency under CCTS • Building Star Labeling Program is under revision",
    hi: "इलेक्ट्रिक कुकिंग हेतु सार्वजनिक सूचना • बीईई द्वारा ऊर्जा प्रबंधकों, ऊर्जा लेखा परीक्षकों एवं ऊर्जा लेखा परीक्षकों (भवन) हेतु राष्ट्रीय परीक्षा 2026 पंजीकरण आमंत्रित • CCTS के अंतर्गत मान्यता प्राप्त कार्बन सत्यापन एजेंसी पर हितधारकों की टिप्पणियाँ आमंत्रित • भवन स्टार लेबलिंग कार्यक्रम संशोधनाधीन",
  },

  // Hero slides
  "slide1.tag": { en: "Standards & Labelling Programme", hi: "मानक एवं लेबलिंग कार्यक्रम" },
  "slide1.title": { en: "Choose Star. Save Power.", hi: "स्टार चुनें। बिजली बचाएँ।" },
  "slide1.sub": { en: "Compare 1-Star to 5-Star rated appliances and cut your electricity bill.", hi: "1-स्टार से 5-स्टार रेटेड उपकरणों की तुलना करें और अपना बिजली बिल घटाएँ।" },
  "slide1.cta": { en: "Browse the Directory", hi: "निर्देशिका देखें" },
  "slide2.tag": { en: "Consumer Protection", hi: "उपभोक्ता संरक्षण" },
  "slide2.title": { en: "Verify Before You Buy", hi: "खरीदने से पहले सत्यापित करें" },
  "slide2.sub": { en: "Scan the BEE QR code to confirm a genuine, registered star label.", hi: "असली, पंजीकृत स्टार लेबल की पुष्टि हेतु बीईई QR कोड स्कैन करें।" },
  "slide2.cta": { en: "Verify a Label", hi: "लेबल सत्यापित करें" },
  "slide3.tag": { en: "Energy Conservation Act, 2001", hi: "ऊर्जा संरक्षण अधिनियम, 2001" },
  "slide3.title": { en: "Efficiency for a Viksit Bharat", hi: "विकसित भारत हेतु ऊर्जा दक्षता" },
  "slide3.sub": { en: "Reducing the energy intensity of the Indian economy, one appliance at a time.", hi: "भारतीय अर्थव्यवस्था की ऊर्जा तीव्रता को कम करना, एक-एक उपकरण से।" },
  "slide3.cta": { en: "About the Bureau", hi: "ब्यूरो के बारे में" },
  "slide4.tag": { en: "National Examination 2026", hi: "राष्ट्रीय परीक्षा 2026" },
  "slide4.title": { en: "Become a Certified Energy Manager", hi: "प्रमाणित ऊर्जा प्रबंधक बनें" },
  "slide4.sub": { en: "Registration is open for Energy Managers & Auditors.", hi: "ऊर्जा प्रबंधकों एवं लेखा परीक्षकों हेतु पंजीकरण खुला है।" },
  "slide4.cta": { en: "View Notifications", hi: "अधिसूचनाएँ देखें" },
  "hero.pause": { en: "Pause slideshow", hi: "स्लाइडशो रोकें" },
  "hero.play": { en: "Play slideshow", hi: "स्लाइडशो चलाएँ" },
  "hero.prev": { en: "Previous slide", hi: "पिछली स्लाइड" },
  "hero.next": { en: "Next slide", hi: "अगली स्लाइड" },

  // Programme tiles
  "prog.title": { en: "Programmes & Schemes", hi: "कार्यक्रम एवं योजनाएँ" },
  "prog.sub": { en: "Flagship demand-side and standards programmes of the Bureau", hi: "ब्यूरो के प्रमुख मांग-पक्ष एवं मानक कार्यक्रम" },
  "prog.sl": { en: "Standards & Labelling", hi: "मानक एवं लेबलिंग" },
  "prog.pat": { en: "PAT Scheme", hi: "PAT योजना" },
  "prog.ecbc": { en: "Energy Conservation Building Code", hi: "ऊर्जा संरक्षण भवन संहिता" },
  "prog.ujala": { en: "UJALA", hi: "उजाला" },
  "prog.carbon": { en: "Indian Carbon Market", hi: "भारतीय कार्बन बाज़ार" },
  "prog.neca": { en: "National Energy Conservation Award", hi: "राष्ट्रीय ऊर्जा संरक्षण पुरस्कार" },

  // Stats / dashboard
  "stats.title": { en: "The Programme at a Glance", hi: "एक नज़र में कार्यक्रम" },
  "stats.models": { en: "Registered Models", hi: "पंजीकृत मॉडल" },
  "stats.savings": { en: "Annual Consumer Savings", hi: "वार्षिक उपभोक्ता बचत" },
  "stats.emissions": { en: "Avoided Emissions", hi: "परिहरित उत्सर्जन" },
  "stats.labs": { en: "NABL Accredited Labs", hi: "NABL मान्यता प्राप्त प्रयोगशालाएँ" },

  // Mission
  "mission.tag": { en: "Our Mandate", hi: "हमारा अधिदेश" },
  "mission.quote": {
    en: "To institutionalise energy efficiency services and reduce the energy intensity of the Indian economy.",
    hi: "ऊर्जा दक्षता सेवाओं को संस्थागत बनाना तथा भारतीय अर्थव्यवस्था की ऊर्जा तीव्रता को कम करना।",
  },
  "mission.by": { en: "Bureau of Energy Efficiency, under the Energy Conservation Act, 2001", hi: "ऊर्जा दक्षता ब्यूरो, ऊर्जा संरक्षण अधिनियम, 2001 के अंतर्गत" },

  // Section headings reused
  "cat.kicker": { en: "Product Categories", hi: "उत्पाद श्रेणियाँ" },
  "cat.title": { en: "Browse by Star-Rated Appliance Category", hi: "स्टार-रेटेड उपकरण श्रेणी के अनुसार देखें" },
  "cat.all": { en: "All 38 Schedules", hi: "सभी 38 अनुसूचियाँ" },
  "portals.title": { en: "Portals & Systems", hi: "पोर्टल एवं प्रणालियाँ" },

  // Photos
  "photo.foundation": { en: "25th Foundation Day — Bureau of Energy Efficiency, New Delhi", hi: "25वाँ स्थापना दिवस — ऊर्जा दक्षता ब्यूरो, नई दिल्ली" },
  "gallery.title": { en: "Photo Gallery", hi: "फोटो गैलरी" },
  "gallery.foundation": { en: "25th Foundation Day", hi: "25वाँ स्थापना दिवस" },
  "gallery.tiranga": { en: "Har Ghar Tiranga Campaign", hi: "हर घर तिरंगा अभियान" },
  "gallery.mann": { en: "Mann Ki Baat Outreach", hi: "मन की बात संवाद" },
  "gallery.neca": { en: "National Energy Conservation Day", hi: "राष्ट्रीय ऊर्जा संरक्षण दिवस" },

  // Footer
  "footer.about": { en: "A statutory body under the Ministry of Power, Government of India, promoting energy efficiency and conservation to reduce the energy intensity of the Indian economy.", hi: "विद्युत मंत्रालय, भारत सरकार के अधीन एक सांविधिक निकाय, जो भारतीय अर्थव्यवस्था की ऊर्जा तीव्रता कम करने हेतु ऊर्जा दक्षता एवं संरक्षण को बढ़ावा देता है।" },
  "footer.quick": { en: "Quick Links", hi: "त्वरित लिंक" },
  "footer.portals": { en: "Portals & Systems", hi: "पोर्टल एवं प्रणालियाँ" },
  "footer.govLinks": { en: "Government Links", hi: "सरकारी लिंक" },
  "footer.visitors": { en: "Visitors", hi: "आगंतुक" },
  "footer.updated": { en: "Last Updated", hi: "अंतिम अद्यतन" },
  "footer.credit": { en: "Website owned and maintained by Bureau of Energy Efficiency (BEE). Designed & developed by M/s Akiko Sherman Infotech; Hosted by NIC/NICSI.", hi: "वेबसाइट ऊर्जा दक्षता ब्यूरो (बीईई) के स्वामित्व एवं अनुरक्षण में। डिज़ाइन एवं विकास मैसर्स अकीको शेरमन इंफोटेक द्वारा; एनआईसी/एनआईसीएसआई द्वारा होस्टेड।" },

  // ---- Officer console ----
  "module.identity": { en: "Identity", hi: "पहचान" },
  "module.administration": { en: "Administration", hi: "प्रशासन" },
  "module.agency-brand": { en: "Agency & Brand", hi: "एजेंसी एवं ब्रांड" },
  "module.model-label": { en: "Model & Label", hi: "मॉडल एवं लेबल" },
  "module.qr-verification": { en: "QR & Verification", hi: "QR एवं सत्यापन" },
  "module.production": { en: "Production", hi: "उत्पादन" },
  "module.finance": { en: "Finance", hi: "वित्त" },
  "module.workflow": { en: "Workflow", hi: "कार्यप्रवाह" },
  "module.withdrawal": { en: "Withdrawal", hi: "वापसी" },
  "module.enforcement": { en: "Enforcement", hi: "प्रवर्तन" },
  "module.helpdesk": { en: "Helpdesk", hi: "हेल्पडेस्क" },
  "module.documents": { en: "Documents", hi: "दस्तावेज़" },
  "module.mis-ai": { en: "MIS & AI", hi: "एमआईएस एवं एआई" },
  "module.audit": { en: "Audit", hi: "अंकेक्षण" },

  "app.officerConsole": { en: "Officer Console", hi: "अधिकारी कंसोल" },
  "app.overview": { en: "Overview", hi: "अवलोकन" },
  "app.allScreens": { en: "All screens", hi: "सभी स्क्रीन" },
  "app.publicPortal": { en: "Public portal", hi: "सार्वजनिक पोर्टल" },
  "app.console": { en: "Console", hi: "कंसोल" },
  "app.search": { en: "Search screens, applications, models, cases…", hi: "स्क्रीन, आवेदन, मॉडल, केस खोजें…" },
  "app.signOut": { en: "Sign out", hi: "साइन आउट" },
  "app.yourAccess": { en: "Your access:", hi: "आपकी पहुँच:" },
  "app.screenSuffix": { en: "screen", hi: "स्क्रीन" },
  "app.noAccess": { en: "No access", hi: "कोई पहुँच नहीं" },
  "app.notAvailable": { en: "This screen is not available to the current role.", hi: "यह स्क्रीन वर्तमान भूमिका के लिए उपलब्ध नहीं है।" },
  "app.switchRole": { en: "Switch role from the top bar to preview it.", hi: "इसे देखने हेतु शीर्ष पट्टी से भूमिका बदलें।" },
  "app.welcome": { en: "Preview workspace: {name}", hi: "पूर्वावलोकन कार्यक्षेत्र: {name}" },
  "app.accessSummary": { en: "This preview shows {visible} of the {total} internal screens, in {modules} work areas, for the selected preview role. It does not show your access.", hi: "यह पूर्वावलोकन चयनित पूर्वावलोकन भूमिका हेतु {total} आंतरिक स्क्रीन में से {visible}, {modules} कार्य क्षेत्रों में, दिखाता है। यह आपकी पहुँच नहीं दर्शाता।" },
  "app.screensForYou": { en: "screens for you", hi: "आपके लिए स्क्रीन" },
  "app.modules": { en: "Modules", hi: "मॉड्यूल" },
  "app.workAreas": { en: "work areas", hi: "कार्य क्षेत्र" },
  "app.workAreasTitle": { en: "Your work areas", hi: "आपके कार्य क्षेत्र" },
  "app.areasWord": { en: "areas", hi: "क्षेत्र" },
  "app.screensWord": { en: "screens", hi: "स्क्रीन" },
  "app.more": { en: "more", hi: "और" },
  "app.kpi.queue": { en: "Tasks in my queue", hi: "मेरी कतार में कार्य" },
  "app.kpi.approval": { en: "Awaiting my approval", hi: "मेरे अनुमोदन की प्रतीक्षा" },
  "app.kpi.sla": { en: "SLA breaches", hi: "एसएलए उल्लंघन" },
  "app.kpi.cleared": { en: "Cleared this month", hi: "इस माह निपटाए गए" },
  // Partner (external-role) overview
  "app.previewRole": { en: "Preview as", hi: "पूर्वावलोकन के रूप में" },
  "app.previewRoleHint": { en: "Development preview only — choose a role to see its prototype screens. This is not your identity, grants no access and never signs you in.", hi: "केवल विकास पूर्वावलोकन — प्रोटोटाइप स्क्रीन देखने हेतु भूमिका चुनें। यह आपकी पहचान नहीं है, कोई पहुँच नहीं देता और साइन इन नहीं करता।" },
  "app.partnerConsole": { en: "Partner Portal", hi: "पार्टनर पोर्टल" },
  "app.partnerSummary": { en: "Preview of a partner workspace — {modules} work areas covering a partner organisation's registrations, models, labels and support.", hi: "पूर्वावलोकन: पार्टनर कार्यक्षेत्र — {modules} कार्य क्षेत्र, जो आपके संगठन के पंजीकरण, मॉडल, लेबल एवं सहायता को कवर करते हैं।" },
  "app.kpi.pModels": { en: "Active approved models", hi: "सक्रिय अनुमोदित मॉडल" },
  "app.kpi.pApplications": { en: "Applications in progress", hi: "प्रगति पर आवेदन" },
  "app.kpi.pQr": { en: "QR batches this quarter", hi: "इस तिमाही QR बैच" },
  "app.kpi.pTickets": { en: "Open support tickets", hi: "खुले सहायता टिकट" },
  // IAME (independent assessor)
  "app.iameSummary": { en: "Preview of an assessor workspace — {modules} areas for assigned model scrutiny and assessment tasks.", hi: "पूर्वावलोकन: मूल्यांकनकर्ता कार्यक्षेत्र — {modules} क्षेत्र, आपको सौंपे गए मॉडल जाँच एवं मूल्यांकन कार्यों हेतु।" },
  "app.kpi.iAssigned": { en: "Assessments assigned", hi: "सौंपे गए मूल्यांकन" },
  "app.kpi.iScrutiny": { en: "Scrutinies in progress", hi: "प्रगति पर जाँच" },
  "app.kpi.iReports": { en: "Reports submitted", hi: "प्रस्तुत रिपोर्ट" },
  // SDA (state designated agency)
  "app.sdaSummary": { en: "Preview of a state enforcement workspace — {modules} areas for sampling, market surveillance and enforcement in a jurisdiction.", hi: "पूर्वावलोकन: राज्य प्रवर्तन कार्यक्षेत्र — {modules} क्षेत्र, आपके क्षेत्राधिकार में नमूनाकरण, बाज़ार निगरानी एवं प्रवर्तन हेतु।" },
  "app.kpi.sCases": { en: "Enforcement cases", hi: "प्रवर्तन प्रकरण" },
  "app.kpi.sSamples": { en: "Samples drawn", hi: "लिए गए नमूने" },
  "app.kpi.sChecks": { en: "Market checks due", hi: "बाज़ार जाँच देय" },
  // Testing laboratory
  "app.labSummary": { en: "Your testing workspace — {modules} areas for the sample tests and challenge-test assignments allocated to your lab.", hi: "आपका परीक्षण कार्यक्षेत्र — {modules} क्षेत्र, आपकी प्रयोगशाला को आवंटित नमूना परीक्षण एवं चुनौती-परीक्षण हेतु।" },
  "app.kpi.lAssignments": { en: "Test assignments", hi: "परीक्षण असाइनमेंट" },
  "app.kpi.lTests": { en: "Tests in progress", hi: "प्रगति पर परीक्षण" },
  "app.kpi.lReports": { en: "Reports issued", hi: "जारी रिपोर्ट" },
  "app.allScreensTitle": { en: "All screens", hi: "सभी स्क्रीन" },
  "app.allScreensSub": { en: "The complete set of {total} internal screens from DDD Annex A.1, across {modules} modules.", hi: "डीडीडी अनुबंध A.1 की सभी {total} आंतरिक स्क्रीन, {modules} मॉड्यूल में।" },
  "app.myAccessOnly": { en: "My access only", hi: "केवल मेरी पहुँच" },
  "app.filterScreens": { en: "Filter screens…", hi: "स्क्रीन फ़िल्टर करें…" },

  // action buttons
  "action.new": { en: "New", hi: "नया" },
  "action.edit": { en: "Edit", hi: "संपादित करें" },
  "action.configure": { en: "Configure", hi: "कॉन्फ़िगर करें" },
  "action.run": { en: "Run action", hi: "कार्य चलाएँ" },
  "action.return": { en: "Return", hi: "लौटाएँ" },
  "action.submit": { en: "Submit", hi: "सबमिट करें" },
  "action.approve": { en: "Approve", hi: "अनुमोदित करें" },
  "action.reject": { en: "Reject", hi: "अस्वीकार करें" },
  "action.export": { en: "Export", hi: "निर्यात करें" },
  "action.viewOnly": { en: "View only", hi: "केवल देखें" },

  // access code long labels
  "access.V": { en: "View", hi: "देखें" },
  "access.C": { en: "Create", hi: "बनाएँ" },
  "access.E": { en: "Edit", hi: "संपादित" },
  "access.S": { en: "Submit", hi: "सबमिट" },
  "access.R": { en: "Review", hi: "समीक्षा" },
  "access.A": { en: "Approve or reject", hi: "अनुमोदन/अस्वीकार" },
  "access.X": { en: "Execute action", hi: "कार्य निष्पादन" },
  "access.G": { en: "Configure or administer", hi: "कॉन्फ़िगर/प्रशासन" },
  "access.D": { en: "Download or export", hi: "डाउनलोड/निर्यात" },
  "access.P": { en: "Public access", hi: "सार्वजनिक पहुँच" },

  // roles
  "role.admin": { en: "BEE Administrator", hi: "बीईई प्रशासक" },
  "role.programme": { en: "Programme Officer", hi: "कार्यक्रम अधिकारी" },
  "role.reviewer": { en: "Reviewer & Approver", hi: "समीक्षक एवं अनुमोदक" },
  "role.director": { en: "Director", hi: "निदेशक" },
  "role.secretary": { en: "Secretary", hi: "सचिव" },
  "role.finance": { en: "BEE Finance", hi: "बीईई वित्त" },
  "role.helpdesk": { en: "Helpdesk Agent", hi: "हेल्पडेस्क एजेंट" },
  "role.auditor": { en: "Auditor", hi: "अंकेक्षक" },
  "role.manufacturer": { en: "Manufacturer", hi: "निर्माता" },
  "role.agency": { en: "Registered Agency", hi: "पंजीकृत एजेंसी" },
  "role.iame": { en: "IAME (Assessor)", hi: "आईएएमई (मूल्यांकनकर्ता)" },
  "role.sda": { en: "State Designated Agency", hi: "राज्य नामित एजेंसी" },
  "role.laboratory": { en: "Testing Laboratory", hi: "परीक्षण प्रयोगशाला" },
  "role.external": { en: "External partner", hi: "बाहरी भागीदार" },
  "role.internal": { en: "BEE / control", hi: "बीईई / नियंत्रण" },

  // Accessibility toolbar
  "a11y.title": { en: "Accessibility", hi: "सुगम्यता" },
  "a11y.bigger": { en: "Bigger text", hi: "बड़ा पाठ" },
  "a11y.smaller": { en: "Smaller text", hi: "छोटा पाठ" },
  "a11y.contrast": { en: "High contrast", hi: "उच्च कंट्रास्ट" },
  "a11y.dyslexia": { en: "Readable font", hi: "सुपाठ्य फ़ॉन्ट" },
  "a11y.reset": { en: "Reset", hi: "रीसेट" },
  "a11y.open": { en: "Accessibility options", hi: "सुगम्यता विकल्प" },
};

export function translate(key: string, lang: Lang): string {
  const entry = DICT[key];
  if (!entry) return key;
  return entry[lang] || entry.en || key;
}
