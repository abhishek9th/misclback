export const SCHEMES = [
  // ==========================================
  // BUSINESS SCHEMES (व्यवसाय योजनाएँ)
  // ==========================================
  {
    id: "scheme_pmegp",
    name: "Prime Minister Employment Generation Programme (PMEGP)",
    name_hi: "प्रधानमंत्री रोजगार सृजन कार्यक्रम (PMEGP)",
    type: "business",
    fields: ["manufacturing", "services", "food_processing", "handicrafts", "agriculture_allied"],
    scope: "central",
    states: ["all"],
    income_limit: null, // No family income ceiling
    eligible_genders: ["all"],
    eligible_categories: ["general", "obc", "sc", "st", "minorities", "ews"],
    business_status: ["new"],
    min_financial_assistance: 100000,
    max_financial_assistance: 5000000, // Up to 50 Lakhs for Manufacturing
    subsidy_percentage: "15% से 35% सब्सिडी",
    interest_rate: "बैंक की सामान्य दर",
    description_hi: "नए सूक्ष्म उद्योग, सेवा या प्रसंस्करण व्यवसाय शुरू करने के लिए 15% से 35% तक सरकारी सब्सिडी के साथ ₹50 लाख तक का ऋण सहायता।",
    benefits_hi: [
      "विनिर्माण क्षेत्र (Manufacturing) के लिए ₹50 लाख तक का प्रोजेक्ट लोन",
      "सेवा और व्यापार क्षेत्र (Services) के लिए ₹20 लाख तक का प्रोजेक्ट लोन",
      "ग्रामीण क्षेत्रों में 25% से 35% तक की सरकारी सब्सिडी",
      "शहरी क्षेत्रों में 15% से 25% तक की सरकारी सब्सिडी"
    ],
    eligibility_reasons_hi: [
      "आप नया व्यवसाय शुरू करना चाहते हैं",
      "चयनित क्षेत्र PMEGP योजना के अंतर्गत आता है",
      "इस योजना में कोई आय सीमा नहीं है",
      "यह भारत के सभी राज्यों में उपलब्ध है"
    ],
    required_documents_hi: [
      "आधार कार्ड / पहचान पत्र",
      "निवास प्रमाण पत्र (डोमीसाइल)",
      "जाति प्रमाण पत्र (यदि लागू हो)",
      "शैक्षणिक योग्यता प्रमाण पत्र (8वीं पास/10वीं पास)",
      "प्रोजेक्ट रिपोर्ट (व्यवसाय योजना विवरण)",
      "बैंक पासबुक की प्रति",
      "पैन कार्ड"
    ],
    application_steps_hi: [
      "आवश्यक दस्तावेज और प्रोजेक्ट रिपोर्ट तैयार करें",
      "KVIC ऑनलाइन पोर्टल (kviconline.gov.in) पर जाएं",
      "PMEGP ऑनलाइन आवेदन पत्र भरें",
      "दस्तावेजों की स्कैन्ड कॉपी अपलोड करें",
      "आवेदन पत्र जमा करके एप्लिकेशन रेफरेंस नंबर सुरक्षित रखें",
      "जिला उद्योग केंद्र (DIC) या बैंक शाखा द्वारा सत्यापन की प्रतीक्षा करें"
    ],
    official_link: "https://www.kviconline.gov.in/pmegpeportal/pmegphome/index.jsp"
  },

  {
    id: "scheme_mudra_shishu",
    name: "PM Mudra Yojana - Shishu Loan",
    name_hi: "प्रधानमंत्री मुद्रा योजना - शिशु ऋण",
    type: "business",
    fields: ["retail_trading", "services", "food_processing", "handicrafts", "agriculture_allied", "transport"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new", "existing"],
    min_financial_assistance: 10000,
    max_financial_assistance: 50000,
    subsidy_percentage: "बिना गारंटी के ऋण",
    interest_rate: "8.5% - 10%",
    description_hi: "छोटे दुकानदारों, रेहड़ी-पटरी वालों और शुरुआती कारोबारियों के लिए ₹50,000 तक का बिना किसी गारंटी के आसान बिजनेस लोन।",
    benefits_hi: [
      "₹50,000 तक की तुरंत आर्थिक सहायता",
      "किसी गारंटी या संपत्ति (Collateral) की आवश्यकता नहीं",
      "मुद्रा कार्ड जारी किया जाता है जिससे आसानी से कार्यशील पूंजी निकाली जा सके",
      "3 से 5 साल तक की आसान किश्तों में पुनर्भुगतान"
    ],
    eligibility_reasons_hi: [
      "छोटे व्यवसाय या दुकान की शुरुआत के लिए उपयुक्त",
      "बिना किसी गिरवी / गारंटी की आवश्यकता",
      "सभी आय वर्ग के नागरिकों के लिए उपलब्ध"
    ],
    required_documents_hi: [
      "आधार कार्ड या वोटर आईडी",
      "पासपोर्ट साइज फोटो (2)",
      "व्यवसाय का प्रमाण या दुकान का पता",
      "बैंक खाता विवरण (पिछली 6 तिमाही का)"
    ],
    application_steps_hi: [
      "निकटतम कमर्शियल बैंक, ग्रामीण बैंक या NBFC शाखा में जाएं",
      "मुद्रा शिशु ऋण फॉर्म भरें",
      "पहचान और पते के दस्तावेज जमा करें",
      "बैंक द्वारा स्वीकृति मिलने पर राशि सीधे खाते में जमा होगी"
    ],
    official_link: "https://www.mudra.org.in/"
  },

  {
    id: "scheme_mudra_kishore",
    name: "PM Mudra Yojana - Kishore & Tarun Loan",
    name_hi: "प्रधानमंत्री मुद्रा योजना - किशोर व तरुण ऋण",
    type: "business",
    fields: ["manufacturing", "retail_trading", "services", "food_processing", "tech_it", "transport", "healthcare"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["existing", "expansion"],
    min_financial_assistance: 50000,
    max_financial_assistance: 1000000,
    subsidy_percentage: "गारंटी-मुक्त बिजनेस लोन",
    interest_rate: "9% - 11.5%",
    description_hi: "पहले से चल रहे व्यवसाय को आगे बढ़ाने, नई मशीनरी खरीदने या विस्तार के लिए ₹50,000 से ₹10 लाख तक की लोन सहायता।",
    benefits_hi: [
      "किशोर श्रेणी: ₹50,000 से ₹5 लाख तक",
      "तरुण श्रेणी: ₹5 लाख से ₹10 लाख तक",
      "बिना कोलैटरल (संपत्ति गिरवी रखे बिना) लोन",
      "व्यवसाय विस्तार के लिए मशीनरी और वर्किंग कैपिटल की सुविधा"
    ],
    eligibility_reasons_hi: [
      "आपका पहले से स्थापित व्यवसाय है या विस्तार करना चाहते हैं",
      "मांगी गई लोन राशि मुद्रा सीमा में है",
      "गारंटी मुक्त सरकारी लोन श्रेणी में आता है"
    ],
    required_documents_hi: [
      "आधार कार्ड और पैन कार्ड",
      "बिजनेस रजिस्ट्रेशन / लाइसेंस या जीएसटी रिटर्न",
      "पिछले 1 साल का बैंक स्टेटमेंट",
      "मशीनरी का कोटेशन या बिल",
      "आय प्रमाण पत्र / आईटीआर (यदि उपलब्ध हो)"
    ],
    application_steps_hi: [
      "UdyamiMitra पोर्टल (udyamimitra.in) पर ऑनलाइन आवेदन करें या बैंक शाखा जाएं",
      "व्यापार की आय और मशीनरी कोटेशन संलग्न करें",
      "बैंक क्रेडिट सत्यापन के बाद ऋण स्वीकृत करेगा"
    ],
    official_link: "https://www.mudra.org.in/"
  },

  {
    id: "scheme_standup_india",
    name: "Stand-Up India Scheme",
    name_hi: "स्टैंड-अप इंडिया योजना (महिला व SC/ST उद्यमी)",
    type: "business",
    fields: ["manufacturing", "services", "retail_trading", "food_processing", "tech_it", "healthcare", "agriculture_allied"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["female", "all"],
    eligible_categories: ["sc", "st"],
    business_status: ["new"],
    min_financial_assistance: 1000000,
    max_financial_assistance: 10000000, // Up to 1 Crore
    subsidy_percentage: "कम ब्याज दर व मार्जिन मनी सपोर्ट",
    interest_rate: "MCLR + 3%",
    description_hi: "अनुसूचित जाति (SC), अनुसूचित जनजाति (ST) और महिला उद्यमियों को नया ग्रीन्फील्ड बिजनेस शुरू करने के लिए ₹10 लाख से ₹1 करोड़ तक का विशाल ऋण।",
    benefits_hi: [
      "₹10 लाख से ₹1 करोड़ तक का बड़ा बैंक लोन",
      "केवल अनुसूचित जाति, जनजाति और महिला उद्यमियों के लिए विशेष प्रावधान",
      "कम्पाउंडिंग मार्जिन मनी सहायता 15%",
      "7 वर्ष तक की लंबी पुनर्भुगतान अवधि"
    ],
    eligibility_reasons_hi: [
      "यह योजना विशेष रूप से महिला, SC और ST उद्यमियों के लिए बनाई गई है",
      "ग्रीनफील्ड (नया) व्यवसाय प्रोजेक्ट शुरू करने के लिए उपयुक्त है",
      "वित्तीय सहायता सीमा ₹1 करोड़ तक है"
    ],
    required_documents_hi: [
      "आधार कार्ड और पैन कार्ड",
      "जाति प्रमाण पत्र (SC/ST के लिए)",
      "प्रोजेक्ट विस्तृत रिपोर्ट (DPR)",
      "भूमि या किराए का समझौता पत्र",
      "कंपनी/फर्म रजिस्ट्रेशन या पार्टनरशिप डीड"
    ],
    application_steps_hi: [
      "StandUp India Portal (standupmitra.in) पर लॉग ऑन करें",
      "रजिस्ट्रेशन करके अपना प्रोफाइल बनाएं",
      "प्रोजेक्ट विवरण दर्ज करें और निकटतम लीड बैंक चुनें",
      "सत्यापन के बाद बैंक लोन जारी करेगा"
    ],
    official_link: "https://www.standupmitra.in/"
  },

  {
    id: "scheme_pm_vishwakarma",
    name: "PM Vishwakarma Scheme",
    name_hi: "प्रधानमंत्री विश्वकर्मा योजना (पारंपरिक कारीगर)",
    type: "business",
    fields: ["handicrafts", "services", "manufacturing"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new", "existing"],
    min_financial_assistance: 15000,
    max_financial_assistance: 300000,
    subsidy_percentage: "₹15,000 टूलकिट अनुदान + रियायती 5% ब्याज ऋण",
    interest_rate: "5% (रियायती ब्याज दर)",
    description_hi: "बढ़ई, लोहार, सुनार, कुम्हार, दर्जी, मूर्तिकार जैसे 18 पारंपरिक कारीगरों के लिए मुफ़्त प्रशिक्षण, ₹15,000 की टूलकिट प्रोत्साहन राशि और 5% ब्याज पर ₹3 लाख तक का लोन।",
    benefits_hi: [
      "₹15,000 का ई-वाउचर आधुनिक टूलकिट (औजार) खरीदने के लिए",
      "प्रथम चरण में ₹1,00000 का लोन (5% रियायती ब्याज पर)",
      "द्वितीय चरण में ₹2,00000 का अतिरिक्त लोन",
      "प्रशिक्षण के दौरान ₹500 प्रतिदिन का दैनिक वजीफा",
      "PM Vishwakarma का आधिकारिक डिजिटल पहचान पत्र और प्रमाण पत्र"
    ],
    eligibility_reasons_hi: [
      "आप हस्तशिल्प या पारंपरिक कारीगरी क्षेत्र में काम करते हैं",
      "पारंपरिक कारीगरों के लिए 5% की सबसे कम ब्याज दर उपलब्ध है",
      "मुफ्त कौशल प्रशिक्षण और औजार की सुविधा शामिल है"
    ],
    required_documents_hi: [
      "आधार कार्ड (मोबाइल नंबर से लिंक)",
      "बैंक पासबुक",
      "राशन कार्ड या परिवार पहचान पत्र",
      "पारंपरिक व्यवसाय का विवरण"
    ],
    application_steps_hi: [
      "निकटतम सीएससी (Common Service Centre / जन सेवा केंद्र) जाएं",
      "PM Vishwakarma Portal पर बायोमेट्रिक प्रमाणीकरण कराएं",
      "ग्राम पंचायत या शहरी स्थानीय निकाय द्वारा सत्यापन कराएं",
      "कौशल प्रशिक्षण पूरा करके ₹15,000 का टूलकिट वाउचर और ऋण प्राप्त करें"
    ],
    official_link: "https://pmvishwakarma.gov.in/"
  },

  {
    id: "scheme_up_msme_swarozgar",
    name: "Mukhyamantri Yuva Swarozgar Yojana (UP)",
    name_hi: "मुख्यमंत्री युवा स्वरोजगार योजना (उत्तर प्रदेश)",
    type: "business",
    fields: ["manufacturing", "services", "food_processing", "retail_trading", "handicrafts"],
    scope: "state",
    states: ["Uttar Pradesh"],
    income_limit: 500000, // Family income up to 5 Lakhs
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new"],
    min_financial_assistance: 100000,
    max_financial_assistance: 2500000,
    subsidy_percentage: "25% तक मार्जिन मनी सब्सिडी",
    interest_rate: "बैंक दर (रियायती)",
    description_hi: "उत्तर प्रदेश के शिक्षित बेरोजगार युवाओं को अपना उद्योग लगाने के लिए ₹25 लाख और सेवा क्षेत्र के लिए ₹10 लाख तक की वित्तीय सहायता 25% सब्सिडी के साथ।",
    benefits_hi: [
      "उद्योग क्षेत्र के लिए ₹25 लाख तक की परियोजना लागत लोन",
      "सेवा क्षेत्र (Service sector) के लिए ₹10 लाख तक का लोन",
      "सरकार द्वारा परियोजना लागत की 25% सब्सिडी (मार्जिन मनी)",
      "उत्तर प्रदेश निवासियों के लिए विशेष राज्य योजना"
    ],
    eligibility_reasons_hi: [
      "यह योजना उत्तर प्रदेश राज्य के निवासियों के लिए उपलब्ध है",
      "आपकी पारिवारिक आय योग्यता सीमा के भीतर है",
      "नया सूक्ष्म उद्योग या सर्विस सेंटर शुरू करने के लिए 25% सब्सिडी उपलब्ध है"
    ],
    required_documents_hi: [
      "उत्तर प्रदेश निवास प्रमाण पत्र",
      "आधार कार्ड",
      "हाईस्कूल (10वीं) अंकपत्र/प्रमाण पत्र (आयु प्रमाण)",
      "आय प्रमाण पत्र (तहसीलदार द्वारा जारी)",
      "प्रोजेक्ट रिपोर्ट"
    ],
    application_steps_hi: [
      "उद्योग साथी पोर्टल (diupmsme.upsdc.gov.in) पर जाएं",
      "मुख्यमंत्री युवा स्वरोजगार योजना के लिए रजिस्ट्रेशन करें",
      "फॉर्म भरकर संबंधित जिला उद्योग केंद्र (DIC) को प्रेषित करें",
      "जिला समिति के साक्षात्कार के बाद बैंक को लोन हेतु प्रेषित किया जाएगा"
    ],
    official_link: "https://diupmsme.upsdc.gov.in/"
  },

  {
    id: "scheme_bihar_udyam",
    name: "Mukhyamantri Udyami Yojana (Bihar)",
    name_hi: "मुख्यमंत्री उद्यमी योजना (बिहार)",
    type: "business",
    fields: ["manufacturing", "food_processing", "services", "handicrafts", "tech_it"],
    scope: "state",
    states: ["Bihar"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["sc", "st", "obc", "ebc", "female", "general"],
    business_status: ["new"],
    min_financial_assistance: 200000,
    max_financial_assistance: 1000000,
    subsidy_percentage: "50% अनुदान (₹5 लाख माफ) + 50% ब्याजमुक्त/1% ऋण",
    interest_rate: "महिला हेतु 0% (ब्याज मुक्त), अन्य हेतु 1%",
    description_hi: "बिहार राज्य के निवासियों को नया उद्योग लगाने के लिए ₹10 लाख की सहायता, जिसमें ₹5 लाख की 50% सीधी सब्सिडी (माफी) और ₹5 लाख का मात्र 0% से 1% पर आसान ऋण शामिल है।",
    benefits_hi: [
      "कुल ₹10 लाख की वित्तीय सहायता",
      "₹5,00,000 की 50% सीधी सरकारी सब्सिडी (अनुदान)",
      "महिलाओं के लिए शेष ₹5 लाख पर 0% ब्याज",
      "अन्य वर्गों के लिए शेष ₹5 लाख पर केवल 1% सांकेतिक ब्याज",
      "84 किश्तों में पुनर्भुगतान"
    ],
    eligibility_reasons_hi: [
      "बिहार राज्य के निवासियों के लिए 50% अनुदान वाली सबसे बड़ी योजना",
      "महिला उद्यमियों के लिए 0% ब्याज दर उपलब्ध है",
      "विनिर्माण एवं प्रसंस्करण क्षेत्र के लिए आदर्श"
    ],
    required_documents_hi: [
      "बिहार का स्थायी निवास प्रमाण पत्र",
      "मैट्रिक / 10वीं का प्रमाण पत्र (जन्म तिथि हेतु)",
      "इंटरमीडिएट या समकक्ष शैक्षणिक योग्यता",
      "जाति प्रमाण पत्र",
      "आधार कार्ड व पैन कार्ड",
      "करंट बैंक अकाउंट की रद्द चेक/पासबुक"
    ],
    application_steps_hi: [
      "उद्योग विभाग बिहार पोर्टल (udyami.bihar.gov.in) पर ऑनलाइन रजिस्ट्रेशन करें",
      "आधार OTP सत्यापन करें",
      "व्यक्तिगत एवं शैक्षणिक विवरण भरकर दस्तावेज अपलोड करें",
      "कंप्यूटराइज्ड लॉटरी चयन प्रक्रिया के बाद प्रशिक्षण व किस्त जारी होगी"
    ],
    official_link: "https://udyami.bihar.gov.in/"
  },

  {
    id: "scheme_pmfme",
    name: "PM Formalisation of Micro Food Processing Enterprises (PMFME)",
    name_hi: "पीएम सूक्ष्म खाद्य उद्योग उन्नयन योजना (PMFME)",
    type: "business",
    fields: ["food_processing", "agriculture_allied"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new", "existing", "expansion"],
    min_financial_assistance: 100000,
    max_financial_assistance: 1000000,
    subsidy_percentage: "35% पूंजीगत सब्सिडी (अधिकतम ₹10 लाख)",
    interest_rate: "बैंक की मानक दर",
    description_hi: "अचार, पापड़, डेयरी, जूस, बेकरी, मसाला पिसान, दाल मिल जैसे खाद्य प्रसंस्करण उद्योग लगाने या पुरानी इकाई को आधुनिक बनाने के लिए 35% क्रेडिट-लिंक्ड सब्सिडी।",
    benefits_hi: [
      "परियोजना लागत का 35% क्रेडिट-लिंक्ड सब्सिडी (अधिकतम ₹10 लाख)",
      "स्वयं सहायता समूहों (SHG) के सदस्यों को ₹40,000 का सीड कैपिटल",
      "ब्रांडिंग और मार्केटिंग सहायता हेतु 50% का अनुदान",
      "खाद्य सुरक्षा मानकों (FSSAI) और पैकेजिंग का निःशुल्क प्रशिक्षण"
    ],
    eligibility_reasons_hi: [
      "खाद्य प्रसंस्करण (Food Processing) क्षेत्र के लिए 35% सब्सिडी मिलती है",
      "नए व पुराने दोनों व्यवसायों को आधुनिकीकरण के लिए समर्थन",
      "देशभर के सभी राज्यों में लागू है"
    ],
    required_documents_hi: [
      "आधार कार्ड व पैन कार्ड",
      "खाद्य इकाई का पता / भूमि पत्र",
      "बैंक स्टेटमेंट एवं प्रोजेक्ट रिपोर्ट",
      "FSSAI रजिस्ट्रेशन/लाइसेंस (पुरानी इकाई हेतु)"
    ],
    application_steps_hi: [
      "PMFME के आधिकारिक पोर्टल (pmfme.mofpi.gov.in) पर जाएं",
      "ऑनलाइन आवेदक पंजीकरण फॉर्म भरें",
      "जिला संसाधन व्यक्ति (District Resource Person - DRP) की सहायता से डीपीआर जमा करें",
      "बैंक द्वारा लोन स्वीकृत होने पर सब्सिडी जमा की जाएगी"
    ],
    official_link: "https://pmfme.mofpi.gov.in/"
  },

  // ==========================================
  // STUDENT SCHEMES (छात्र योजनाएँ)
  // ==========================================
  {
    id: "scheme_csss_scholarship",
    name: "Central Sector Scheme of Scholarship (CSSS)",
    name_hi: "सेंट्रल सेक्टर स्कॉलरशिप योजना (CSSS)",
    type: "student",
    student_type: "scholarship",
    education_levels: ["undergraduate", "postgraduate"],
    course_fields: ["engineering", "medical", "management", "arts", "science", "law", "agriculture", "other"],
    scope: "central",
    states: ["all"],
    income_limit: 450000, // Up to 4.5 Lakhs
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    min_financial_assistance: 12000,
    max_financial_assistance: 20000,
    subsidy_percentage: "100% छात्रवृत्ति अनुदान",
    description_hi: "12वीं में 80वीं पर्सेंटाइल से अधिक अंक प्राप्त करने वाले मेधावी छात्रों को स्नातक (UG) में ₹12,000/वर्ष और स्नातकोत्तर (PG) में ₹20,000/वर्ष की छात्रवृत्ति।",
    benefits_hi: [
      "स्नातक के प्रथम 3 वर्षों के लिए ₹12,000 प्रति वर्ष",
      "स्नातकोत्तर (PG) के लिए ₹20,000 प्रति वर्ष",
      "प्रोफेशनल कोर्स (4-5 वर्ष) में 4वें और 5वें साल ₹20,000 प्रति वर्ष",
      "राशि सीधे छात्र के बैंक खाते (DBT) में हस्तांतरित"
    ],
    eligibility_reasons_hi: [
      "12वीं कक्षा पास करने वाले मेधावी छात्रों के लिए उपयुक्त",
      "आपकी पारिवारिक आय सीमा (₹4.5 लाख) के भीतर है",
      "डिग्री और मास्टर कोर्स की पढ़ाई के लिए वित्तीय मदद"
    ],
    required_documents_hi: [
      "10वीं एवं 12वीं की मार्कशीट",
      "आय प्रमाण पत्र (सक्षम अधिकारी द्वारा)",
      "आधार कार्ड (बैंक खाते से लिंक)",
      "वर्तमान कॉलेज में दाखिले की रसीद/आईडी",
      "बैंक पासबुक"
    ],
    application_steps_hi: [
      "नेशनल स्कॉलरशिप पोर्टल (scholarships.gov.in) पर जाएं",
      "नया स्टूडेंट रजिस्ट्रेशन (NSP Registration) करें",
      "आधिकारिक विवरण और 12वीं रोल नंबर दर्ज करें",
      "दस्तावेज अपलोड कर संस्थान (College) सत्यापन हेतु जमा करें"
    ],
    official_link: "https://scholarships.gov.in/"
  },

  {
    id: "scheme_vidya_lakshmi",
    name: "Vidya Lakshmi Education Loan Portal",
    name_hi: "विद्या लक्ष्मी शिक्षा ऋण पोर्टल",
    type: "student",
    student_type: "education_loan",
    education_levels: ["undergraduate", "postgraduate", "professional", "phd", "overseas"],
    course_fields: ["engineering", "medical", "management", "arts", "science", "law", "agriculture", "other"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    min_financial_assistance: 100000,
    max_financial_assistance: 4000000, // Up to 40 Lakhs
    subsidy_percentage: "ब्याज सबवेंशन सहायता योजना लागू",
    interest_rate: "8% - 10.5%",
    description_hi: "भारत और विदेश में उच्च शिक्षा, इंजीनियरिंग, मेडिकल या मैनेजमेंट की पढ़ाई के लिए सिंगल विंडो पोर्टल के जरिए ₹40 लाख तक का आसान एजुकेशन लोन।",
    benefits_hi: [
      "₹4 लाख तक के लोन के लिए किसी सुरक्षा/गारंटी की जरूरत नहीं",
      "₹7.5 लाख तक के लोन हेतु क्रेडिट गारंटी फंड (CSIS) की सुविधा",
      "आर्थिक रूप से कमजोर वर्गों हेतु पढ़ाई के दौरान ब्याज पर 100% सब्सिडी",
      "एक ही फॉर्म से 3 अलग-अलग बैंकों में एक साथ आवेदन का विकल्प"
    ],
    eligibility_reasons_hi: [
      "उच्च शिक्षा / प्रोफेशनल कोर्स की पढ़ाई के लिए लोन",
      "भारत या विदेश में पढ़ाई के लिए उपयुक्त",
      "ऑनलाइन पारदर्शी आवेदन एवं स्टेटस ट्रैकिंग"
    ],
    required_documents_hi: [
      "10वीं/12वीं/ग्रेजुएशन मार्कशीट",
      "कॉलेज एडमिशन लेटर और फीस स्ट्रक्चर विवरण",
      "विद्यार्थी एवं अभिभावक का आधार व पैन कार्ड",
      "अभिभावक का आय प्रमाण पत्र व पिछले 6 माह का बैंक खाता विवरण"
    ],
    application_steps_hi: [
      "Vidya Lakshmi Portal (vidyalakshmi.co.in) पर अकाउंट बनाएं",
      "Common Educational Loan Application Form (CELAF) भरें",
      "अपनी पसंद की 3 बैंक शाखाएं चुनें",
      "दस्तावेज अपलोड करके ऑनलाइन सबमिट करें और स्टेटस ट्रैक करें"
    ],
    official_link: "https://www.vidyalakshmi.co.in/"
  },

  {
    id: "scheme_post_matric_scholarship",
    name: "Post-Matric Scholarship for SC/ST/OBC Students",
    name_hi: "पोस्ट-मैट्रिक छात्रवृत्ति (SC / ST / OBC छात्र)",
    type: "student",
    student_type: "scholarship",
    education_levels: ["class_10_12", "undergraduate", "postgraduate", "professional"],
    course_fields: ["engineering", "medical", "management", "arts", "science", "law", "agriculture", "other"],
    scope: "central",
    states: ["all"],
    income_limit: 250000, // 2.5 Lakhs limit
    eligible_genders: ["all"],
    eligible_categories: ["sc", "st", "obc"],
    min_financial_assistance: 5000,
    max_financial_assistance: 50000,
    subsidy_percentage: "100% नॉन-रिफंडेबल फीस वापसी + रखरखाव भत्ता",
    description_hi: "10वीं के बाद (11वीं, 12वीं, आईटीआई, डिप्लोमा, डिग्री, मेडिकल, इंजीनियरिंग) की पढ़ाई कर रहे अनुसूचित जाति, जनजाति और पिछड़ा वर्ग के छात्रों की पूरी ट्यूशन फीस वापसी।",
    benefits_hi: [
      "कॉलेज की 100% अनिवार्य गैर-वापसी योग्य फीस (Non-refundable Fee) की प्रतिपूर्ति",
      "छात्रावास में रहने वाले छात्रों के लिए मासिक रखरखाव भत्ता (Maintenance allowance)",
      "डे स्कॉलर छात्रों के लिए विशेष भत्ता",
      "राशि सीधे आधार से जुड़े बैंक खाते में (DBT)"
    ],
    eligibility_reasons_hi: [
      "10वीं के बाद आगे की पढ़ाई जारी रखने के लिए पूरी फीस वापसी",
      "आपकी सामाजिक श्रेणी और आय सीमा योजना से मेल खाती है",
      "छात्रावास और किताबों का खर्च भी शामिल है"
    ],
    required_documents_hi: [
      "जाति प्रमाण पत्र (डिजिटल सत्यापित)",
      "आय प्रमाण पत्र (नवीनतम)",
      "निवास प्रमाण पत्र",
      "पिछली कक्षा की मार्कशीट",
      "वर्तमान पाठ्यक्रम का फीस रसीद एवं कॉलेज आईडी",
      "आधार कार्ड (बैंक खाते से सीडेड)"
    ],
    application_steps_hi: [
      "अपने राज्य के स्कॉलरशिप पोर्टल या नेशनल स्कॉलरशिप पोर्टल (NSP) पर जाएं",
      "Post-Matric Scholarship योजना चुनें",
      "कॉलेज व फीस विवरण भरकर दस्तावेज अपलोड करें",
      "फॉर्म का प्रिंटआउट अपने कॉलेज में जमा करें"
    ],
    official_link: "https://scholarships.gov.in/"
  },

  {
    id: "scheme_pm_yasasvi",
    name: "PM YASASvi Scholarship for OBC/EBC/DNT",
    name_hi: "पीएम यशस्वी छात्रवृत्ति योजना (OBC/EBC/DNT)",
    type: "student",
    student_type: "scholarship",
    education_levels: ["school", "class_10_12"],
    course_fields: ["arts", "science", "other"],
    scope: "central",
    states: ["all"],
    income_limit: 250000,
    eligible_genders: ["all"],
    eligible_categories: ["obc", "ebc"],
    min_financial_assistance: 75000,
    max_financial_assistance: 125000,
    subsidy_percentage: "वार्षिक स्कॉलरशिप अनुदान",
    description_hi: "उत्कृष्ट स्कूलों में पढ़ रहे 9वीं से 12वीं के पिछड़े वर्ग (OBC/EBC) के प्रतिभाशाली विद्यार्थियों को ₹75,000 से ₹1,25,000 प्रति वर्ष की बड़ी छात्रवृत्ति।",
    benefits_hi: [
      "कक्षा 9वीं और 10वीं के छात्रों को ₹75,000 प्रति वर्ष",
      "कक्षा 11वीं और 12वीं के छात्रों को ₹1,25,000 प्रति वर्ष",
      "स्कूल की फीस, हॉस्टल की फीस और किताबों की खरीद हेतु पूर्ण वित्तीय सहायता"
    ],
    eligibility_reasons_hi: [
      "स्कूली शिक्षा (9वीं से 12वीं) के लिए सबसे बड़ी वित्तीय छात्रवृत्ति",
      "पारिवारिक आय limit ₹2.5 लाख तक के लिए लागू",
      "मेधावी विद्यार्थियों के लिए विशेष अवसर"
    ],
    required_documents_hi: [
      "विद्यार्थी का आधार कार्ड",
      "पिछली कक्षा की अंकसूची",
      "OBC / EBC जाति प्रमाण पत्र",
      "आय प्रमाण पत्र",
      "स्कूल का प्रवेश पत्र / फीस रसीद"
    ],
    application_steps_hi: [
      "NSP पोर्टल पर पीएम यशस्वी योजना का चयन करें",
      "आवेदक का पंजीकरण करें",
      "आवश्यक दस्तावेज अपलोड करके जमा करें"
    ],
    official_link: "https://yet.nta.ac.in/"
  },

  {
    id: "scheme_abhyudaya_coaching",
    name: "Mukhyamantri Abhyudaya Yojana (Free Coaching)",
    name_hi: "मुख्यमंत्री अभ्युदय योजना (निःशुल्क कोचिंग)",
    type: "student",
    student_type: "coaching_support",
    education_levels: ["undergraduate", "postgraduate", "professional"],
    course_fields: ["engineering", "medical", "management", "arts", "science", "law", "other"],
    scope: "state",
    states: ["Uttar Pradesh"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    min_financial_assistance: 0,
    max_financial_assistance: 50000, // Value of free coaching + tablets
    subsidy_percentage: "100% मुफ़्त कोचिंग व डिजिटल टैबलेट",
    description_hi: "UPSC, UPPSC, JEE, NEET, NDA, CDS और बैंकिंग परीक्षाओं की तैयारी कर रहे विद्यार्थियों के लिए अनुभवी अधिकारियों द्वारा मुफ़्त भौतिक व ऑनलाइन कोचिंग तथा मुफ़्त टैबलेट।",
    benefits_hi: [
      "IAS, IPS, PCS, JEE, NEET परीक्षाओं की 100% मुफ़्त कोचिंग",
      "शीर्ष प्रशासनिक अधिकारियों द्वारा सीधे मार्गदर्शन और कक्षाएं",
      "चयनित मेधावी छात्रों को पढ़ाई हेतु मुफ़्त टैबलेट वितरण",
      "निःशुल्क अध्ययन सामग्री व डिजिटल लाइब्रेरी एक्सेस"
    ],
    eligibility_reasons_hi: [
      "उत्तर प्रदेश राज्य के विद्यार्थियों के लिए प्रतियोगिता परीक्षा कोचिंग",
      "प्रवेश परीक्षा व सिविल सर्विसेज की नि:शुल्क तैयारी",
      "डिजिटल लर्निंग टैबलेट प्राप्त करने का अवसर"
    ],
    required_documents_hi: [
      "उत्तर प्रदेश का निवास प्रमाण पत्र",
      "आधार कार्ड",
      "हाईस्कूल/इंटरमीडिएट/ग्रेजुएशन मार्कशीट",
      "पासपोर्ट साइज फोटो"
    ],
    application_steps_hi: [
      "अभ्युदय पोर्टल (abhyuday.up.gov.in) पर पंजीकरण करें",
      "जिस प्रतियोगिता परीक्षा की कोचिंग चाहिए उसका चयन करें",
      "ऑनलाइन पात्रता परीक्षा (Eligibility Test) में भाग लें",
      "मेरिट सूची के आधार पर अपने जिले के केंद्र में निःशुल्क प्रवेश लें"
    ],
    official_link: "https://abhyuday.up.gov.in/"
  },

  {
    id: "scheme_national_overseas",
    name: "National Overseas Scholarship (NOS)",
    name_hi: "राष्ट्रीय विदेशी छात्रवृत्ति योजना (विदेश पढ़ाई)",
    type: "student",
    student_type: "overseas",
    education_levels: ["postgraduate", "phd", "overseas"],
    course_fields: ["engineering", "medical", "management", "science", "arts", "agriculture"],
    scope: "central",
    states: ["all"],
    income_limit: 800000, // Up to 8 Lakhs
    eligible_genders: ["all"],
    eligible_categories: ["sc", "st"],
    min_financial_assistance: 500000,
    max_financial_assistance: 3500000, // Per year funding
    subsidy_percentage: "100% फीस + रहने का खर्च + हवाई टिकट",
    description_hi: "विदेश के शीर्ष विश्वविद्यालयों में मास्टर डिग्री या पीएचडी (Ph.D.) करने की इच्छा रखने वाले SC/ST वर्ग के छात्रों के लिए पूरी ट्यूशन फीस, रहने का भत्ता और हवाई किराया।",
    benefits_hi: [
      "विदेश के विश्वविद्यालय की 100% ट्यूशन फीस",
      "वार्षिक रखरखाव भत्ता (अमेरिका/अन्य देश हेतु $15,400 / ब्रिटेन हेतु £9,900)",
      "आगमन और वापसी का इकोनॉमी क्लास हवाई टिकट",
      "मेडिकल इंश्योरेंस और वीजा फीस की पूरी भरपाई"
    ],
    eligibility_reasons_hi: [
      "विदेश की टॉप यूनिवर्सिटीज में मास्टर्स या पीएचडी करने हेतु",
      "आय सीमा ₹8 लाख के अंतर्गत आने वाले छात्रों के लिए उपलब्ध",
      "100% खर्चों का वहन भारत सरकार द्वारा"
    ],
    required_documents_hi: [
      "विदेशी यूनिवर्सिटी का अनकंडीशनल एडमिशन लेटर",
      "जाति प्रमाण पत्र",
      "सक्षम प्राधिकारी का आय प्रमाण पत्र",
      "वैध पासपोर्ट",
      "ग्रेजुएशन/पोस्ट-ग्रेजुएशन मार्कशीट (न्यूनतम 60% अंक)"
    ],
    application_steps_hi: [
      "सामाजिक न्याय मंत्रालय के पोर्टल (nosmsje.gov.in) पर जाएं",
      "ऑनलाइन फॉर्म भरें और एडमिशन लेटर संलग्न करें",
      "स्क्रीनिंग कमेटी के साक्षात्कार व सत्यापन के बाद छात्रवृत्ति स्वीकृत होगी"
    ],
    official_link: "https://nosmsje.gov.in/"
  },

  {
    id: "scheme_pragati_girls",
    name: "AICTE Pragati Scholarship for Girl Students",
    name_hi: "एआईसीटीई प्रगति छात्रवृत्ति योजना (छात्राएं)",
    type: "student",
    student_type: "scholarship",
    education_levels: ["undergraduate", "professional"],
    course_fields: ["engineering", "tech_it"],
    scope: "central",
    states: ["all"],
    income_limit: 800000,
    eligible_genders: ["female"],
    eligible_categories: ["all"],
    min_financial_assistance: 50000,
    max_financial_assistance: 50000,
    subsidy_percentage: "₹50,000 प्रति वर्ष प्रोत्साहन राशि",
    description_hi: "तकनीकी शिक्षा (इंजीनियरिंग / डिप्लोमा / डिग्री) में दाखिला लेने वाली मेधावी छात्राओं को हर साल ₹50,000 की प्रोत्साहन स्कॉलरशिप राशि।",
    benefits_hi: [
      "₹50,000 प्रति वर्ष की छात्रवृत्ति (डिग्री के सभी 4 वर्षों के लिए)",
      "कॉलेज फीस, कंप्यूटर खरीद, किताबों और स्टेशनरी का खर्च",
      "प्रति परिवार अधिकतम 2 छात्राओं के लिए मान्य"
    ],
    eligibility_reasons_hi: [
      "तकनीकी और इंजीनियरिंग पाठ्यक्रमों में पढ़ रही छात्राओं के लिए",
      "आय सीमा ₹8 लाख तक मान्य है",
      "छात्रा शिक्षा को बढ़ावा देने के लिए विशेष प्रावधान"
    ],
    required_documents_hi: [
      "AICTE मान्यता प्राप्त संस्थान में प्रथम वर्ष एडमिशन का प्रमाण",
      "10वीं और 12वीं की मार्कशीट",
      "माता-पिता का आय प्रमाण पत्र",
      "आधार कार्ड व बैंक खाता विवरण"
    ],
    application_steps_hi: [
      "National Scholarship Portal (NSP) पर प्रगति छात्रवृत्ति चुनें",
      "संस्थान और रोल नंबर दर्ज कर फॉर्म भरें",
      "कॉलेज द्वारा NSP पर सत्यापन के पश्चात राशि जारी होगी"
    ],
    official_link: "https://scholarships.gov.in/"
  },

  // ==========================================
  // SKILL & EMPLOYMENT SCHEMES (कौशल व रोजगार)
  // ==========================================
  {
    id: "scheme_pmkvy",
    name: "Pradhan Mantri Kaushal Vikas Yojana (PMKVY 4.0)",
    name_hi: "प्रधानमंत्री कौशल विकास योजना (PMKVY 4.0)",
    type: "skill_employment",
    fields: ["services", "manufacturing", "tech_it", "healthcare", "tourism", "handicrafts", "retail_trading", "other"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new", "existing"],
    min_financial_assistance: 0,
    max_financial_assistance: 100000, // Value of free certification + stipend
    subsidy_percentage: "100% नि:शुल्क कौशल प्रशिक्षण + सरकारी सर्टिफिकेट",
    description_hi: "ड्रोन टेक्नोलॉजी, कोडिंग, सिलाई, इलेक्ट्रॉनिक्स, सोलर, हेल्थकेयर आदि में 100% मुफ़्त उद्योग-उन्मुख कौशल प्रशिक्षण, दैनिक वजीफा और सरकारी जॉब प्लेसमेंट।",
    benefits_hi: [
      "निःशुल्क अल्पकालिक प्रशिक्षण (Short Term Training - STT)",
      "पूर्व अनुभव रखने वालों के लिए RPL (Recognition of Prior Learning) सर्टिफिकेशन",
      "सरकारी मान्यता प्राप्त राष्ट्रीय कौशल प्रमाणपत्र (NSQF Certificate)",
      "रोजगार मेलों के माध्यम से कंपनियों में सीधी नौकरी की सुविधा"
    ],
    eligibility_reasons_hi: [
      "कौशल सीखकर नौकरी या स्वयं का काम शुरू करने के लिए",
      "निःशुल्क प्रशिक्षण और मान्यता प्राप्त प्रमाणपत्र",
      "आयु 15 से 45 वर्ष के सभी युवाओं के लिए उपलब्ध"
    ],
    required_documents_hi: [
      "आधार कार्ड",
      "बैंक पासबुक",
      "न्यूनतम शैक्षणिक योग्यता (5वीं/8वीं/10वीं/12वीं)"
    ],
    application_steps_hi: [
      "Skill India Digital portal (skillindiadigital.gov.in) पर जाएं",
      "अपने नजदीकी पीएमकेवीवाई प्रशिक्षण केंद्र खोजें",
      "मनपसंद ट्रेड (कोर्स) में मुफ़्त नामांकन कराएं",
      "प्रशिक्षण पूरा करके परीक्षा दें और जॉब प्लेसमेंट पाएं"
    ],
    official_link: "https://www.skillindiadigital.gov.in/"
  },

  {
    id: "scheme_ddu_gky",
    name: "Deen Dayal Upadhyaya Grameen Kaushalya Yojana (DDU-GKY)",
    name_hi: "दीनदयाल उपाध्याय ग्रामीण कौशल्या योजना (ग्रामीण युवा)",
    type: "skill_employment",
    fields: ["services", "manufacturing", "retail_trading", "healthcare", "tourism"],
    scope: "central",
    states: ["all"],
    income_limit: 300000,
    eligible_genders: ["all"],
    eligible_categories: ["all"],
    business_status: ["new"],
    min_financial_assistance: 0,
    max_financial_assistance: 80000,
    subsidy_percentage: "100% मुफ़्त रहने, खाने व ट्रेनिंग की व्यवस्था",
    description_hi: "ग्रामीण गरीब परिवारों के 15 से 35 वर्ष के युवाओं को मुफ़्त रहने, खाने और आधुनिक कंपनियों में गारंटीकृत नौकरी दिलाने की योजना।",
    benefits_hi: [
      "प्रशिक्षण के दौरान मुफ़्त हॉस्टल (रहना), भोजन और यूनिफॉर्म",
      "कम से कम 70% प्रशिक्षित युवाओं को संगठित क्षेत्र में गारंटीकृत नौकरी",
      "प्लेसमेंट के बाद शुरुआती महीनों में ₹1,000 से ₹3,000 का अतिरिक्त करियर सहायता भत्ता",
      "निःशुल्क कंप्यूटर व अंग्रेजी भाषा का ज्ञान"
    ],
    eligibility_reasons_hi: [
      "ग्रामीण क्षेत्र के युवाओं के लिए रहने व खाने सहित 100% मुफ़्त प्रशिक्षण",
      "प्रशिक्षण के तुरंत बाद गारंटीकृत जॉब प्लेसमेंट",
      "आय सीमा BPL/ग्रामीण आय से मेल खाती है"
    ],
    required_documents_hi: [
      "गांव का निवास प्रमाण पत्र / आधार",
      "राशन कार्ड (BPL या मनरेगा जॉब कार्ड)",
      "आयु प्रमाण पत्र",
      "बैंक पासबुक"
    ],
    application_steps_hi: [
      "अपने ग्राम पंचायत सचिव / रोजगार सेवक से संपर्क करें",
      "DDU-GKY के पोर्टल (ddugky.gov.in) पर पंजीकरण करें",
      "आवास प्रशिक्षण केंद्र में दाखिला लें"
    ],
    official_link: "http://ddugky.gov.in/"
  },

  {
    id: "scheme_smile_transgender_support",
    name: "SMILE Scheme - Support for Transgender Persons",
    name_hi: "स्माइल योजना - ट्रांसजेंडर व्यक्तियों के लिए सहायता",
    type: "business",
    fields: ["all"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["lgbtq"],
    eligible_categories: ["all"],
    business_status: ["new", "existing", "expansion"],
    min_financial_assistance: 0,
    max_financial_assistance: 100000,
    subsidy_percentage: "कौशल प्रशिक्षण और आजीविका सहायता",
    description_hi: "ट्रांसजेंडर व्यक्तियों के लिए कौशल प्रशिक्षण, आजीविका सहायता, परामर्श और पुनर्वास सेवाओं का समर्थन।",
    benefits_hi: [
      "कौशल विकास और रोजगार से जुड़ी सहायता",
      "आजीविका और स्वरोजगार के लिए मार्गदर्शन",
      "स्वास्थ्य, परामर्श और पुनर्वास सेवाओं तक पहुंच"
    ],
    required_documents_hi: ["आधार कार्ड / पहचान पत्र", "ट्रांसजेंडर प्रमाण पत्र", "बैंक खाता विवरण", "निवास प्रमाण पत्र"],
    application_steps_hi: [
      "National Portal for Transgender Persons पर पंजीकरण करें",
      "ट्रांसजेंडर प्रमाण पत्र और पहचान दस्तावेज अपलोड करें",
      "उपलब्ध कौशल, आजीविका या पुनर्वास सहायता चुनें",
      "संबंधित जिला समाज कल्याण कार्यालय से सत्यापन कराएं"
    ],
    official_link: "https://transgender.dosje.gov.in/"
  },

  {
    id: "scheme_national_handicapped_finance",
    name: "National Divyangjan Finance and Development Corporation Support",
    name_hi: "राष्ट्रीय दिव्यांगजन वित्त एवं विकास निगम सहायता",
    type: "business",
    fields: ["all"],
    scope: "central",
    states: ["all"],
    income_limit: null,
    eligible_genders: ["pwd"],
    eligible_categories: ["all"],
    business_status: ["new", "existing", "expansion"],
    min_financial_assistance: 10000,
    max_financial_assistance: 1000000,
    subsidy_percentage: "रियायती ब्याज दर पर ऋण",
    description_hi: "दिव्यांगजन के लिए स्वरोजगार, शिक्षा, कौशल प्रशिक्षण और छोटे व्यवसाय हेतु रियायती वित्तीय सहायता।",
    benefits_hi: [
      "स्वरोजगार और छोटे व्यवसाय के लिए रियायती ऋण",
      "कौशल प्रशिक्षण और आय-सृजन गतिविधियों के लिए सहायता",
      "दिव्यांगजन वित्त विकास निगम या राज्य चैनलाइजिंग एजेंसी के माध्यम से आवेदन"
    ],
    required_documents_hi: ["दिव्यांगता प्रमाण पत्र / UDID कार्ड", "आधार कार्ड", "आय प्रमाण पत्र", "व्यवसाय या प्रशिक्षण योजना", "बैंक खाता विवरण"],
    application_steps_hi: [
      "UDID कार्ड या दिव्यांगता प्रमाण पत्र तैयार रखें",
      "अपने राज्य की चैनलाइजिंग एजेंसी या जिला समाज कल्याण कार्यालय से संपर्क करें",
      "ऋण या प्रशिक्षण सहायता के लिए आवेदन जमा करें",
      "सत्यापन के बाद स्वीकृति और वितरण की प्रक्रिया पूरी करें"
    ],
    official_link: "https://www.nhfdc.nic.in/"
  },

  {
    id: "scheme_post_matric_disability_scholarship",
    name: "Post-Matric Scholarship for Students with Disabilities",
    name_hi: "दिव्यांग विद्यार्थियों के लिए पोस्ट-मैट्रिक छात्रवृत्ति",
    type: "student",
    student_type: "scholarship",
    education_levels: ["class_10_12", "undergraduate", "postgraduate", "professional", "phd", "all"],
    course_fields: ["engineering", "medical", "management", "arts", "science", "law", "agriculture", "other", "all"],
    scope: "central",
    states: ["all"],
    income_limit: 250000,
    eligible_genders: ["pwd"],
    eligible_categories: ["all"],
    max_financial_assistance: 50000,
    subsidy_percentage: "शुल्क और भत्ता सहायता",
    description_hi: "दिव्यांग विद्यार्थियों की पोस्ट-मैट्रिक और उच्च शिक्षा के लिए शुल्क, पुस्तक और सहायक भत्ते की सहायता।",
    benefits_hi: [
      "शिक्षण शुल्क और अनिवार्य शुल्क में सहायता",
      "पुस्तक, अनुरक्षक और अन्य निर्धारित भत्ते",
      "मान्यता प्राप्त संस्थानों में उच्च शिक्षा जारी रखने का समर्थन"
    ],
    required_documents_hi: ["दिव्यांगता प्रमाण पत्र / UDID कार्ड", "आय प्रमाण पत्र", "पिछली कक्षा की अंकतालिका", "संस्थान का प्रवेश प्रमाण", "बैंक खाता विवरण"],
    application_steps_hi: [
      "National Scholarship Portal पर पंजीकरण करें",
      "दिव्यांग विद्यार्थियों की पोस्ट-मैट्रिक छात्रवृत्ति चुनें",
      "UDID, आय और प्रवेश दस्तावेज अपलोड करें",
      "संस्थान और जिला स्तर के सत्यापन के बाद छात्रवृत्ति प्राप्त करें"
    ],
    official_link: "https://scholarships.gov.in/"
  }
];
