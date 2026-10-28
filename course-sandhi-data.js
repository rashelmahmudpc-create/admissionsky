(() => {
  const course = {
  "id": "sandhi-interactive-v1",
  "category": "bangla",
  "language": "bn",
  "title": "সন্ধি, Interactive Quiz Course",
  "subtitle": "বাংলা ২য় পত্র · Concept → Rule → Trap → Practice",
  "icon": "সন্ধি",
  "source": {
    "fileName": "sandhi-master-guide.pdf",
    "sha256": "56c2dd65f4551d9483b798572275b52d11fb5f99a4f62f00575e3e2743626494",
    "pages": 84,
    "authority": "original-pdf",
    "pageAssetPattern": "./course-assets/sandhi/pages/p{page:03d}.webp",
    "pdfPath": "./course-assets/sandhi/sandhi-master-guide.pdf"
  },
  "profile": {
    "mode": "interactive-quiz",
    "lessonStyle": "source-specific",
    "enabledInteractions": [
      "mcq",
      "true-false",
      "matching",
      "trap-choice",
      "rule-sort"
    ],
    "masteryThreshold": 80
  },
  "stats": {
    "pages": 84,
    "lessons": 8,
    "slides": 40,
    "mcqs": 60
  },
  "sourceUnits": [
    {
      "id": "sandhi-overview",
      "title": "Topic Overview ও Master Map",
      "startPage": 1,
      "endPage": 5,
      "kind": "overview"
    },
    {
      "id": "sandhi-lesson-01",
      "title": "সন্ধির মূল তত্ত্ব ও দ্বৈত বিভাজন",
      "startPage": 6,
      "endPage": 9,
      "kind": "interactive",
      "style": "concept-classification"
    },
    {
      "id": "sandhi-lesson-02",
      "title": "খাঁটি বাংলা সন্ধি",
      "startPage": 10,
      "endPage": 12,
      "kind": "interactive",
      "style": "native-bangla"
    },
    {
      "id": "sandhi-lesson-03",
      "title": "তৎসম স্বরসন্ধি, ১ম পর্ব",
      "startPage": 13,
      "endPage": 16,
      "kind": "interactive",
      "style": "swarasandhi-guna"
    },
    {
      "id": "sandhi-lesson-04",
      "title": "তৎসম স্বরসন্ধি, ২য় পর্ব",
      "startPage": 17,
      "endPage": 21,
      "kind": "interactive",
      "style": "vriddhi-phala"
    },
    {
      "id": "sandhi-lesson-05",
      "title": "তৎসম ব্যঞ্জনসন্ধি, ১ম পর্ব",
      "startPage": 22,
      "endPage": 26,
      "kind": "interactive",
      "style": "consonant-varga"
    },
    {
      "id": "sandhi-lesson-06",
      "title": "তৎসম ব্যঞ্জনসন্ধি, ২য় পর্ব",
      "startPage": 27,
      "endPage": 30,
      "kind": "interactive",
      "style": "consonant-special"
    },
    {
      "id": "sandhi-lesson-07",
      "title": "বিসর্গ সন্ধির অপারেশন",
      "startPage": 31,
      "endPage": 35,
      "kind": "interactive",
      "style": "visarga"
    },
    {
      "id": "sandhi-lesson-08",
      "title": "নিপাতনে সিদ্ধ ও মাস্টার রিভিশন",
      "startPage": 36,
      "endPage": 40,
      "kind": "interactive",
      "style": "nipatane-master"
    },
    {
      "id": "sandhi-master-revision",
      "title": "Master Chart, Trap Database ও 50 Rules",
      "startPage": 41,
      "endPage": 56,
      "kind": "reference"
    },
    {
      "id": "sandhi-source-question-bank",
      "title": "Source Admission MCQ Bank",
      "startPage": 57,
      "endPage": 82,
      "kind": "practice"
    },
    {
      "id": "sandhi-answer-map",
      "title": "Final Answer Key ও Master Map",
      "startPage": 83,
      "endPage": 84,
      "kind": "answer-key"
    }
  ],
  "lessons": [
    {
      "id": "sandhi-lesson-01",
      "title": "সন্ধির মূল তত্ত্ব ও দ্বৈত বিভাজন",
      "startPage": 6,
      "endPage": 9,
      "style": "concept-classification",
      "sourcePages": [
        6,
        7,
        8,
        9
      ],
      "steps": [
        {
          "id": "sandhi-lesson-01-source",
          "type": "source-reference",
          "sourcePages": [
            6,
            7,
            8,
            9
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-01-practice",
          "type": "quiz",
          "sourcePages": [
            6,
            7,
            8,
            9
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-02",
      "title": "খাঁটি বাংলা সন্ধি",
      "startPage": 10,
      "endPage": 12,
      "style": "native-bangla",
      "sourcePages": [
        10,
        11,
        12
      ],
      "steps": [
        {
          "id": "sandhi-lesson-02-source",
          "type": "source-reference",
          "sourcePages": [
            10,
            11,
            12
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-02-practice",
          "type": "quiz",
          "sourcePages": [
            10,
            11,
            12
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-03",
      "title": "তৎসম স্বরসন্ধি, ১ম পর্ব",
      "startPage": 13,
      "endPage": 16,
      "style": "swarasandhi-guna",
      "sourcePages": [
        13,
        14,
        15,
        16
      ],
      "steps": [
        {
          "id": "sandhi-lesson-03-source",
          "type": "source-reference",
          "sourcePages": [
            13,
            14,
            15,
            16
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-03-practice",
          "type": "quiz",
          "sourcePages": [
            13,
            14,
            15,
            16
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-04",
      "title": "তৎসম স্বরসন্ধি, ২য় পর্ব",
      "startPage": 17,
      "endPage": 21,
      "style": "vriddhi-phala",
      "sourcePages": [
        17,
        18,
        19,
        20,
        21
      ],
      "steps": [
        {
          "id": "sandhi-lesson-04-source",
          "type": "source-reference",
          "sourcePages": [
            17,
            18,
            19,
            20,
            21
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-04-practice",
          "type": "quiz",
          "sourcePages": [
            17,
            18,
            19,
            20,
            21
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-05",
      "title": "তৎসম ব্যঞ্জনসন্ধি, ১ম পর্ব",
      "startPage": 22,
      "endPage": 26,
      "style": "consonant-varga",
      "sourcePages": [
        22,
        23,
        24,
        25,
        26
      ],
      "steps": [
        {
          "id": "sandhi-lesson-05-source",
          "type": "source-reference",
          "sourcePages": [
            22,
            23,
            24,
            25,
            26
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-05-practice",
          "type": "quiz",
          "sourcePages": [
            22,
            23,
            24,
            25,
            26
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-06",
      "title": "তৎসম ব্যঞ্জনসন্ধি, ২য় পর্ব",
      "startPage": 27,
      "endPage": 30,
      "style": "consonant-special",
      "sourcePages": [
        27,
        28,
        29,
        30
      ],
      "steps": [
        {
          "id": "sandhi-lesson-06-source",
          "type": "source-reference",
          "sourcePages": [
            27,
            28,
            29,
            30
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-06-practice",
          "type": "quiz",
          "sourcePages": [
            27,
            28,
            29,
            30
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-07",
      "title": "বিসর্গ সন্ধির অপারেশন",
      "startPage": 31,
      "endPage": 35,
      "style": "visarga",
      "sourcePages": [
        31,
        32,
        33,
        34,
        35
      ],
      "steps": [
        {
          "id": "sandhi-lesson-07-source",
          "type": "source-reference",
          "sourcePages": [
            31,
            32,
            33,
            34,
            35
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-07-practice",
          "type": "quiz",
          "sourcePages": [
            31,
            32,
            33,
            34,
            35
          ],
          "verification": "approved"
        }
      ]
    },
    {
      "id": "sandhi-lesson-08",
      "title": "নিপাতনে সিদ্ধ ও মাস্টার রিভিশন",
      "startPage": 36,
      "endPage": 40,
      "style": "nipatane-master",
      "sourcePages": [
        36,
        37,
        38,
        39,
        40
      ],
      "steps": [
        {
          "id": "sandhi-lesson-08-source",
          "type": "source-reference",
          "sourcePages": [
            36,
            37,
            38,
            39,
            40
          ],
          "verification": "approved"
        },
        {
          "id": "sandhi-lesson-08-practice",
          "type": "quiz",
          "sourcePages": [
            36,
            37,
            38,
            39,
            40
          ],
          "verification": "approved"
        }
      ]
    }
  ],
  "pages": [
    {
      "page": 1,
      "asset": "./course-assets/sandhi/pages/p001.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=1"
    },
    {
      "page": 2,
      "asset": "./course-assets/sandhi/pages/p002.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=2"
    },
    {
      "page": 3,
      "asset": "./course-assets/sandhi/pages/p003.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=3"
    },
    {
      "page": 4,
      "asset": "./course-assets/sandhi/pages/p004.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=4"
    },
    {
      "page": 5,
      "asset": "./course-assets/sandhi/pages/p005.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=5"
    },
    {
      "page": 6,
      "asset": "./course-assets/sandhi/pages/p006.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=6"
    },
    {
      "page": 7,
      "asset": "./course-assets/sandhi/pages/p007.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=7"
    },
    {
      "page": 8,
      "asset": "./course-assets/sandhi/pages/p008.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=8"
    },
    {
      "page": 9,
      "asset": "./course-assets/sandhi/pages/p009.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=9"
    },
    {
      "page": 10,
      "asset": "./course-assets/sandhi/pages/p010.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=10"
    },
    {
      "page": 11,
      "asset": "./course-assets/sandhi/pages/p011.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=11"
    },
    {
      "page": 12,
      "asset": "./course-assets/sandhi/pages/p012.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=12"
    },
    {
      "page": 13,
      "asset": "./course-assets/sandhi/pages/p013.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=13"
    },
    {
      "page": 14,
      "asset": "./course-assets/sandhi/pages/p014.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=14"
    },
    {
      "page": 15,
      "asset": "./course-assets/sandhi/pages/p015.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=15"
    },
    {
      "page": 16,
      "asset": "./course-assets/sandhi/pages/p016.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=16"
    },
    {
      "page": 17,
      "asset": "./course-assets/sandhi/pages/p017.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=17"
    },
    {
      "page": 18,
      "asset": "./course-assets/sandhi/pages/p018.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=18"
    },
    {
      "page": 19,
      "asset": "./course-assets/sandhi/pages/p019.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=19"
    },
    {
      "page": 20,
      "asset": "./course-assets/sandhi/pages/p020.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=20"
    },
    {
      "page": 21,
      "asset": "./course-assets/sandhi/pages/p021.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=21"
    },
    {
      "page": 22,
      "asset": "./course-assets/sandhi/pages/p022.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=22"
    },
    {
      "page": 23,
      "asset": "./course-assets/sandhi/pages/p023.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=23"
    },
    {
      "page": 24,
      "asset": "./course-assets/sandhi/pages/p024.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=24"
    },
    {
      "page": 25,
      "asset": "./course-assets/sandhi/pages/p025.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=25"
    },
    {
      "page": 26,
      "asset": "./course-assets/sandhi/pages/p026.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=26"
    },
    {
      "page": 27,
      "asset": "./course-assets/sandhi/pages/p027.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=27"
    },
    {
      "page": 28,
      "asset": "./course-assets/sandhi/pages/p028.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=28"
    },
    {
      "page": 29,
      "asset": "./course-assets/sandhi/pages/p029.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=29"
    },
    {
      "page": 30,
      "asset": "./course-assets/sandhi/pages/p030.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=30"
    },
    {
      "page": 31,
      "asset": "./course-assets/sandhi/pages/p031.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=31"
    },
    {
      "page": 32,
      "asset": "./course-assets/sandhi/pages/p032.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=32"
    },
    {
      "page": 33,
      "asset": "./course-assets/sandhi/pages/p033.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=33"
    },
    {
      "page": 34,
      "asset": "./course-assets/sandhi/pages/p034.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=34"
    },
    {
      "page": 35,
      "asset": "./course-assets/sandhi/pages/p035.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=35"
    },
    {
      "page": 36,
      "asset": "./course-assets/sandhi/pages/p036.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=36"
    },
    {
      "page": 37,
      "asset": "./course-assets/sandhi/pages/p037.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=37"
    },
    {
      "page": 38,
      "asset": "./course-assets/sandhi/pages/p038.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=38"
    },
    {
      "page": 39,
      "asset": "./course-assets/sandhi/pages/p039.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=39"
    },
    {
      "page": 40,
      "asset": "./course-assets/sandhi/pages/p040.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=40"
    },
    {
      "page": 41,
      "asset": "./course-assets/sandhi/pages/p041.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=41"
    },
    {
      "page": 42,
      "asset": "./course-assets/sandhi/pages/p042.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=42"
    },
    {
      "page": 43,
      "asset": "./course-assets/sandhi/pages/p043.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=43"
    },
    {
      "page": 44,
      "asset": "./course-assets/sandhi/pages/p044.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=44"
    },
    {
      "page": 45,
      "asset": "./course-assets/sandhi/pages/p045.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=45"
    },
    {
      "page": 46,
      "asset": "./course-assets/sandhi/pages/p046.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=46"
    },
    {
      "page": 47,
      "asset": "./course-assets/sandhi/pages/p047.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=47"
    },
    {
      "page": 48,
      "asset": "./course-assets/sandhi/pages/p048.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=48"
    },
    {
      "page": 49,
      "asset": "./course-assets/sandhi/pages/p049.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=49"
    },
    {
      "page": 50,
      "asset": "./course-assets/sandhi/pages/p050.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=50"
    },
    {
      "page": 51,
      "asset": "./course-assets/sandhi/pages/p051.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=51"
    },
    {
      "page": 52,
      "asset": "./course-assets/sandhi/pages/p052.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=52"
    },
    {
      "page": 53,
      "asset": "./course-assets/sandhi/pages/p053.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=53"
    },
    {
      "page": 54,
      "asset": "./course-assets/sandhi/pages/p054.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=54"
    },
    {
      "page": 55,
      "asset": "./course-assets/sandhi/pages/p055.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=55"
    },
    {
      "page": 56,
      "asset": "./course-assets/sandhi/pages/p056.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=56"
    },
    {
      "page": 57,
      "asset": "./course-assets/sandhi/pages/p057.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=57"
    },
    {
      "page": 58,
      "asset": "./course-assets/sandhi/pages/p058.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=58"
    },
    {
      "page": 59,
      "asset": "./course-assets/sandhi/pages/p059.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=59"
    },
    {
      "page": 60,
      "asset": "./course-assets/sandhi/pages/p060.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=60"
    },
    {
      "page": 61,
      "asset": "./course-assets/sandhi/pages/p061.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=61"
    },
    {
      "page": 62,
      "asset": "./course-assets/sandhi/pages/p062.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=62"
    },
    {
      "page": 63,
      "asset": "./course-assets/sandhi/pages/p063.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=63"
    },
    {
      "page": 64,
      "asset": "./course-assets/sandhi/pages/p064.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=64"
    },
    {
      "page": 65,
      "asset": "./course-assets/sandhi/pages/p065.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=65"
    },
    {
      "page": 66,
      "asset": "./course-assets/sandhi/pages/p066.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=66"
    },
    {
      "page": 67,
      "asset": "./course-assets/sandhi/pages/p067.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=67"
    },
    {
      "page": 68,
      "asset": "./course-assets/sandhi/pages/p068.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=68"
    },
    {
      "page": 69,
      "asset": "./course-assets/sandhi/pages/p069.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=69"
    },
    {
      "page": 70,
      "asset": "./course-assets/sandhi/pages/p070.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=70"
    },
    {
      "page": 71,
      "asset": "./course-assets/sandhi/pages/p071.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=71"
    },
    {
      "page": 72,
      "asset": "./course-assets/sandhi/pages/p072.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=72"
    },
    {
      "page": 73,
      "asset": "./course-assets/sandhi/pages/p073.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=73"
    },
    {
      "page": 74,
      "asset": "./course-assets/sandhi/pages/p074.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=74"
    },
    {
      "page": 75,
      "asset": "./course-assets/sandhi/pages/p075.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=75"
    },
    {
      "page": 76,
      "asset": "./course-assets/sandhi/pages/p076.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=76"
    },
    {
      "page": 77,
      "asset": "./course-assets/sandhi/pages/p077.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=77"
    },
    {
      "page": 78,
      "asset": "./course-assets/sandhi/pages/p078.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=78"
    },
    {
      "page": 79,
      "asset": "./course-assets/sandhi/pages/p079.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=79"
    },
    {
      "page": 80,
      "asset": "./course-assets/sandhi/pages/p080.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=80"
    },
    {
      "page": 81,
      "asset": "./course-assets/sandhi/pages/p081.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=81"
    },
    {
      "page": 82,
      "asset": "./course-assets/sandhi/pages/p082.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=82"
    },
    {
      "page": 83,
      "asset": "./course-assets/sandhi/pages/p083.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=83"
    },
    {
      "page": 84,
      "asset": "./course-assets/sandhi/pages/p084.webp",
      "pdf": "./course-assets/sandhi/sandhi-master-guide.pdf#page=84"
    }
  ],
  "mcqs": [
    {
      "id": "sandhi-source-mcq-001",
      "number": 1,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সন্ধি' ব্যাকরণের কোন অংশে আলোচিত হয়?",
      "options": [
        "শব্দতত্ত্ব বা রূপতত্ত্ব",
        "ধ্বনিতত্ত্ব",
        "বাক্যতত্ত্ব",
        "অর্থতত্ত্ব"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "সন্ধিতে মূলত সন্নিহিত দুটি ধ্বনির মিলন, পরিবর্ত ন বা বিলোপ ঘটে। যেহেতু এর সমস্ত প্রক্রিয়া ধ্বনিকে কেন্দ্র করে পরিচালিত হয়, তাই সন্ধি ব্যাকরণের 'ধ্বনিতত্ত্ব' (Phonology)-এর অন্তর্ভু ক্ত।",
      "sourcePage": 57,
      "sourceBlockId": "sandhi-p057-mcq-001",
      "family": "01 🟢 BASIC • সরাসরি তত্ত্ব",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-002",
      "number": 2,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "সন্ধির প্রধান উদ্দেশ্য কোনটি?",
      "options": [
        "শব্দের অর্থ পরিবর্ত ন করা",
        "পদ সংক্ষেপ করা",
        "উচ্চারণের সুবিধা ও ধ্বনিমাধুর্য",
        "নতু ন শব্দভাণ্ডার বৃদ্ধি করা সম্পাদন"
      ],
      "answer": 2,
      "correctLetter": "C",
      "explanation": "পাশাপাশি দুটি ধ্বনি দ্রুত উচ্চারণের সময় জিহ্বার পরিশ্রম কমানো (উচ্চারণের সুবিধা) এবং শ্রুতিমধুর রূপ দেওয়া (ধ্বনিমাধুর্য)-ই সন্ধির মূল উদ্দেশ্য। পদ সংক্ষেপ করা হলো সমাসের কাজ।",
      "sourcePage": 58,
      "sourceBlockId": "sandhi-p058-mcq-002",
      "family": "02 🟢 BASIC • উদ্দেশ্য",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-003",
      "number": 3,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "খাঁটি বাংলা ভাষায় সন্ধি প্রধানত কত প্রকার?",
      "options": [
        "২ প্রকার",
        "৩ প্রকার",
        "৪ প্রকার",
        "৫ প্রকার"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "খাঁটি বাংলা ভাষায় সন্ধি মাত্র ২ প্রকার: ১. স্বরসন্ধি ও ২. ব্যঞ্জনসন্ধি। কিন্তু তৎসম বা সংস্কৃ ত ভাষার সন্ধি ৩ প্রকার (স্বর, ব্যঞ্জন ও বিসর্গ)।",
      "sourcePage": 58,
      "sourceBlockId": "sandhi-p058-mcq-003",
      "family": "03 🟢 BASIC • শ্রেণিবিভাগ",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-004",
      "number": 4,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "খাঁটি বাংলা ভাষায় কোন প্রকার সন্ধির অস্তিত্ব নেই?",
      "options": [
        "স্বরসন্ধি",
        "ব্যঞ্জনসন্ধি",
        "বিসর্গ সন্ধি",
        "নিপাতনে সিদ্ধ সন্ধি"
      ],
      "answer": 2,
      "correctLetter": "C",
      "explanation": "খাঁটি বাংলা ধ্বনিতে কোনো বিসর্গ (ঃ) ধ্বনি নেই। বিসর্গ কেবল সংস্কৃ ত বা তৎসম শব্দের ক্ষেত্রে প্রযোজ্য। তাই খাঁটি বাংলায় বিসর্গ সন্ধি নেই।",
      "sourcePage": 59,
      "sourceBlockId": "sandhi-p059-mcq-004",
      "family": "04 🟣 TRAP • বাংলা সন্ধি",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-005",
      "number": 5,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ঘোড়দৌড়' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ঘোটক + দৌড়",
        "ঘোড়া + দৌড়",
        "ঘোড় + দৌড়",
        "ঘোট + দৌড়"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "এটি খাঁটি বাংলা ব্যঞ্জনসন্ধি। বাংলা শব্দে সংস্কৃ ত মূল 'ঘোটক' ব্যবহার করা যাবে না। ঘোড়া + দৌড় মিলে আ-কার লোপ পেয়ে হয়েছে ঘোড়দৌড়।",
      "sourcePage": 59,
      "sourceBlockId": "sandhi-p059-mcq-005",
      "family": "05 🟡 INTERMEDIATE • বাংলা সন্ধি",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-006",
      "number": 6,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'চৌদ্দ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "চতুঃ + দশ",
        "চৌ + দশ",
        "চার + দশ",
        "চতু ষ + দশ"
      ],
      "answer": 2,
      "correctLetter": "C",
      "explanation": "এটি বাংলা সংখ্যাবাচক বিশেষ সন্ধি। চার + দশ মিলে 'চৌদ্দ' হয়েছে। চতুঃ+দশ হলো তৎসম 'চতু র্দ শ'-এর বিচ্ছেদ।",
      "sourcePage": 59,
      "sourceBlockId": "sandhi-p059-mcq-006",
      "family": "06 🟡 INTERMEDIATE • বাংলা সন্ধি",
      "lessonId": "sandhi-lesson-01"
    },
    {
      "id": "sandhi-source-mcq-007",
      "number": 7,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'হিমালয়' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "হিম + আলয়",
        "হিমা + লয়",
        "হিম + লয়",
        "হিমা + আলয়"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "অ + আ = আ। হিম (অ) + আলয় (আ) = হিমালয়।",
      "sourcePage": 60,
      "sourceBlockId": "sandhi-p060-mcq-007",
      "family": "07 🟢 BASIC • স্বরসন্ধি",
      "lessonId": "sandhi-lesson-02"
    },
    {
      "id": "sandhi-source-mcq-008",
      "number": 8,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নবান্ন' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নবা + অন্ন",
        "নব + অন্ন",
        "নব + আন্ন",
        "নবা + ন্ন"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ + অ = আ। নব (অ) + অন্ন (অ) = নবান্ন।",
      "sourcePage": 60,
      "sourceBlockId": "sandhi-p060-mcq-008",
      "family": "08 🟢 BASIC • স্বরসন্ধি",
      "lessonId": "sandhi-lesson-02"
    },
    {
      "id": "sandhi-source-mcq-009",
      "number": 9,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'রবীন্দ্র' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "রবি + ইন্দ্র",
        "রবী + ইন্দ্র",
        "রবি + ঈন্দ্র",
        "রবী + ঈন্দ্র"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "ই + ই = ঈ (দীর্ঘ ঈ)। রবি (হ্রস্ব ই) এবং ইন্দ্র (হ্রস্ব ই)। উভয়ে মিলে সন্ধিবদ্ধ শব্দে 'রবীন্দ্র'- তে দীর্ঘ ঈ হয়েছে।",
      "sourcePage": 60,
      "sourceBlockId": "sandhi-p060-mcq-009",
      "family": "09 🟢 BASIC • স্বরসন্ধি",
      "lessonId": "sandhi-lesson-02"
    },
    {
      "id": "sandhi-source-mcq-010",
      "number": 10,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পরীক্ষা' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পরি + ইক্ষা",
        "পরি + ঈক্ষা",
        "পরী + ইক্ষা",
        "পরী + ঈক্ষা"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "পরি উপসর্গ হ্রস্ব ই-কারযুক্ত, কিন্তু 'ঈক্ষা' (দর্শন/দেখা) বানানে দীর্ঘ ঈ। ই + ঈ = ঈ।",
      "sourcePage": 61,
      "sourceBlockId": "sandhi-p061-mcq-010",
      "family": "10 🔴 ADMISSION • বানান ও সন্ধি",
      "lessonId": "sandhi-lesson-02"
    },
    {
      "id": "sandhi-source-mcq-011",
      "number": 11,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মরূদ্যান' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মরু + উদ্যান",
        "মরূ + উদ্যান",
        "মরু + ঊদ্যান",
        "মরূ + ঊদ্যান"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "মরু (হ্রস্ব উ) + উদ্যান (হ্রস্ব উ)। উ + উ = ঊ (দীর্ঘ ঊ)। তাই সন্ধিবদ্ধ শব্দে মরূদ্যান (দীর্ঘ ঊ) হয়।",
      "sourcePage": 61,
      "sourceBlockId": "sandhi-p061-mcq-011",
      "family": "11 🔴 ADMISSION • স্বরসন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-012",
      "number": 12,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'লঘূর্মি' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "লঘু + উর্মি",
        "লঘু + ঊর্মি",
        "লঘূ + উর্মি",
        "লঘূ + ঊর্মি"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "লঘু (ছোট, হ্রস্ব উ) + ঊর্মি (ঢেউ, দীর্ঘ ঊ)। উ + ঊ = ঊ। ঊর্মি বানানে সর্বদা দীর্ঘ ঊ হয়।",
      "sourcePage": 61,
      "sourceBlockId": "sandhi-p061-mcq-012",
      "family": "12 🔴 ADMISSION • বানান সতর্ক তা",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-013",
      "number": 13,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'শুভেচ্ছা' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "শুভ + ইচ্ছা",
        "শুভা + ইচ্ছা",
        "শুভ + ঈচ্ছা",
        "শুভে + ইচ্ছা"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "অ + ই = এ। শুভ (অ) + ইচ্ছা (ই) = শুভেচ্ছা (গুণ সন্ধি)।",
      "sourcePage": 62,
      "sourceBlockId": "sandhi-p062-mcq-013",
      "family": "13 🟡 INTERMEDIATE • গুণ সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-014",
      "number": 14,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নরেশ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নর + ইশ",
        "নর + ঈশ",
        "নরা + ঈশ",
        "নরে + শ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "'ঈশ' (প্রভু /ঈশ্বর) বানানে সর্বদা দীর্ঘ ঈ। অ + ঈ = এ। নর + ঈশ = নরেশ।",
      "sourcePage": 62,
      "sourceBlockId": "sandhi-p062-mcq-014",
      "family": "14 🟡 INTERMEDIATE • গুণ সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-015",
      "number": 15,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সূর্যোদয়' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সুর্য + উদয়",
        "সূর্য + উদয়",
        "সূর্য + ঊদয়",
        "সূর্যা + উদয়"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ + উ = ও। সূর্য (অ) + উদয় (উ) = সূর্যোদয়।",
      "sourcePage": 62,
      "sourceBlockId": "sandhi-p062-mcq-015",
      "family": "15 🟢 BASIC • গুণ সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-016",
      "number": 16,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মহর্ষি' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মহা + ঋষি",
        "মহা + ঋষি",
        "মহ + ঋষি",
        "মহঃ + ঋষি"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "আ + ঋ = অর্ (রেফ)। মহা + ঋষি = মহর্ষি।",
      "sourcePage": 63,
      "sourceBlockId": "sandhi-p063-mcq-016",
      "family": "16 🟡 INTERMEDIATE • গুণ সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-017",
      "number": 17,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'শীতার্ত ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "শীত + আর্ত",
        "শীত + ঋত",
        "শীতা + ঋত",
        "শীতঃ + আর্ত"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "'ঋত' শব্দ পরে থাকলে অ/আ + ঋ মিলে 'আর্' হয়। ফলে পূর্বপদে আ-কার আসে। শীত + ঋত = শীতার্ত (শীত দ্বারা পীড়িত)।",
      "sourcePage": 63,
      "sourceBlockId": "sandhi-p063-mcq-017",
      "family": "17 🟣 TRAP • ঋত প্রত্যয়",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-018",
      "number": 18,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ক্ষু ধার্ত ' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ক্ষু ধা + আর্ত",
        "ক্ষু ধা + ঋত",
        "ক্ষু ধ + ঋত",
        "ক্ষু ধঃ + আর্ত"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "আ + ঋত = আর্। ক্ষু ধা + ঋত = ক্ষু ধার্ত ।",
      "sourcePage": 63,
      "sourceBlockId": "sandhi-p063-mcq-018",
      "family": "18 🟣 TRAP • ঋত প্রত্যয়",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-019",
      "number": 19,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'জনৈক' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "জন + ঐক্য",
        "জন + এক",
        "জনা + এক",
        "জনৌ + এক"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ + এ = ঐ। জন (অ) + এক (এ) = জনৈক। অনেকে ভু ল করে 'ঐক্য' ভাবে, যা সম্পূর্ণ ভু ল।",
      "sourcePage": 64,
      "sourceBlockId": "sandhi-p064-mcq-019",
      "family": "19 🟡 INTERMEDIATE • বৃদ্ধি সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-020",
      "number": 20,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মতৈক্য' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মত + এক",
        "মত + ঐক্য",
        "মতা + ঐক্য",
        "মতৌ + ঐক্য"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ + ঐ = ঐ। মত (অ) + ঐক্য (ঐ) = মতৈক্য। এখানে 'ঐক্য' শব্দের নিজস্ব বানানই ঐ-কারযুক্ত।",
      "sourcePage": 64,
      "sourceBlockId": "sandhi-p064-mcq-020",
      "family": "20 🟡 INTERMEDIATE • বৃদ্ধি সন্ধি",
      "lessonId": "sandhi-lesson-03"
    },
    {
      "id": "sandhi-source-mcq-021",
      "number": 21,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'বনৌষধি' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "বন + ওষধি",
        "বন + ঔষধি",
        "বনা + ওষধি",
        "বনৌ + ওষধি"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "অ + ও = ঔ। বন (অ) + ওষধি (ও) = বনৌষধি। মনে রাখবেন, ওষধি বানানে ও-কার হয়।",
      "sourcePage": 64,
      "sourceBlockId": "sandhi-p064-mcq-021",
      "family": "21 🔴 ADMISSION • বৃদ্ধি সন্ধি",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-022",
      "number": 22,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মহৌষধ' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মহা + ওষধ",
        "মহা + ঔষধ",
        "মহ + ঔষধ",
        "মহৌ + সধ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "আ + ঔ = ঔ। মহা (আ) + ঔষধ (ঔ) = মহৌষধ। ঔষধ বানানে ঔ-কার থাকে।",
      "sourcePage": 65,
      "sourceBlockId": "sandhi-p065-mcq-022",
      "family": "22 🔴 ADMISSION • বৃদ্ধি সন্ধি",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-023",
      "number": 23,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ইত্যাদি' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ইত্য + আদি",
        "ইতি + আদি",
        "ইত + আদি",
        "ইতি + আদী"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ই + আ = যা (য-ফলা)। ইতি (ই) + আদি (আ) = ইত্যাদি।",
      "sourcePage": 65,
      "sourceBlockId": "sandhi-p065-mcq-023",
      "family": "23 🟢 BASIC • য-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-024",
      "number": 24,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'প্রত্যেক' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "প্রত্য + এক",
        "প্রতি + এক",
        "প্রতী + এক",
        "প্রত + এক"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ই + এ = যে (য-ফলা + এ-কার)। প্রতি + এক = প্রত্যেক।",
      "sourcePage": 65,
      "sourceBlockId": "sandhi-p065-mcq-024",
      "family": "24 🟡 INTERMEDIATE • য-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-025",
      "number": 25,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'যদ্যপি' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "যদি + অপি",
        "যদ্য + অপি",
        "যদি + পি",
        "যদা + অপি"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "ই + অ = য। যদি + অপি = যদ্যপি।",
      "sourcePage": 66,
      "sourceBlockId": "sandhi-p066-mcq-025",
      "family": "25 🟡 INTERMEDIATE • য-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-026",
      "number": 26,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নদ্যম্বু' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নদী + অম্বূ",
        "নদী + অম্বু",
        "নদ + অম্বু",
        "নদী + আম্বু"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ঈ + অ = য। নদী (দীর্ঘ ঈ) + অম্বু (পানি) = নদ্যম্বু (নদীর জল)।",
      "sourcePage": 66,
      "sourceBlockId": "sandhi-p066-mcq-026",
      "family": "26 🔴 ADMISSION • য-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-027",
      "number": 27,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'অন্বেষণ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "অন্ব + এষণ",
        "অনু + এষণ",
        "অনু + এষণা",
        "অন্বে + ষণ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "উ + এ = বে (ব-ফলা + এ-কার)। অনু + এষণ = অন্বেষণ।",
      "sourcePage": 66,
      "sourceBlockId": "sandhi-p066-mcq-027",
      "family": "27 🔴 ADMISSION • ব-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-028",
      "number": 28,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'স্বাগত' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "স্ব + আগত",
        "সু + আগত",
        "স + আগত",
        "স্বা + গত"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "উ + আ = বা (ব-ফলা + আ-কার)। সু + আগত = স্বাগত (উত্তম আগমন)। 'স্ব+আগত' ভু ল!",
      "sourcePage": 67,
      "sourceBlockId": "sandhi-p067-mcq-028",
      "family": "28 🟡 INTERMEDIATE • ব-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-029",
      "number": 29,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'তন্বী' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "তনু + ঈ",
        "তন্ব + ঈ",
        "তনু + ই",
        "তন + বী"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "উ + ঈ = বী (ব-ফলা + দীর্ঘ ঈ-কার)। তনু (কৃ শ দেহ) + ঈ (স্ত্রী প্রত্যয়) = তন্বী।",
      "sourcePage": 67,
      "sourceBlockId": "sandhi-p067-mcq-029",
      "family": "29 🔴 ADMISSION • ব-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-030",
      "number": 30,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পিত্রালয়' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পিত্র + আলয়",
        "পিতৃ + আলয়",
        "পিতা + আলয়",
        "পিতৃ + লয়"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ঋ + আ = রা (র-ফলা + আ-কার)। পিতৃ + আলয় = পিত্রালয়। ভর্তি পরীক্ষা প্রশ্নব্যাংক 📝 (Admission MCQ Bank : 31–60) ব্যঞ্জনসন্ধি, বিসর্গ সন্ধি ও নিপাতনে সিদ্ধ সন্ধির উচ্চতর প্রশ্নাবলি",
      "sourcePage": 67,
      "sourceBlockId": "sandhi-p067-mcq-030",
      "family": "30 🔴 ADMISSION • র-ফলা সূত্র",
      "lessonId": "sandhi-lesson-04"
    },
    {
      "id": "sandhi-source-mcq-031",
      "number": 31,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নয়ন' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নে + অন",
        "নই + অন",
        "নো + অন",
        "নয় + অন"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "এ + অন = অয়ন। নে + অন = নয়ন। অনুরূপভাবে: শে + অন = শয়ন।",
      "sourcePage": 68,
      "sourceBlockId": "sandhi-p068-mcq-031",
      "family": "31 🟡 INTERMEDIATE • অয়্ সূত্র",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-032",
      "number": 32,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'গায়ক' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "গা + অক",
        "গৈ + অক",
        "গো + অক",
        "গে + অক"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ঐ + অক = আয়ক। গৈ + অক = গায়ক। অনুরূপভাবে: নৈ + অক = নায়ক।",
      "sourcePage": 68,
      "sourceBlockId": "sandhi-p068-mcq-032",
      "family": "32 🟡 INTERMEDIATE • আয়্ সূত্র",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-033",
      "number": 33,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পাবক' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পো + অক",
        "পৌ + অক",
        "পা + অক",
        "পব + অক"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ঔ + অক = আবক। পৌ + অক = পাবক (আগুন)। কিন্তু পো + অন = পবন (বাতাস)।",
      "sourcePage": 69,
      "sourceBlockId": "sandhi-p069-mcq-033",
      "family": "33 🔴 ADMISSION • আব্ সূত্র",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-034",
      "number": 34,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নাবিক' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নৌ + ইক",
        "নো + ইক",
        "না + ইক",
        "নাব + ইক"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "ঔ + ইক = আবিক। নৌ + ইক = নাবিক।",
      "sourcePage": 69,
      "sourceBlockId": "sandhi-p069-mcq-034",
      "family": "34 🔴 ADMISSION • আব্ সূত্র",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-035",
      "number": 35,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'দিগন্ত' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "দিগ + অন্ত",
        "দিক্ + অন্ত",
        "দিগ্ + অন্ত",
        "দি + গন্ত"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ক্ + অ = গ (বর্গের ১ম ধ্বনি ৩য় ধ্বনি হয়েছে)। দিক্ + অন্ত = দিগন্ত। হসন্ত (্) থাকা আবশ্যক।",
      "sourcePage": 69,
      "sourceBlockId": "sandhi-p069-mcq-035",
      "family": "35 🟢 BASIC • বর্গী য় ১ম→৩য়",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-036",
      "number": 36,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ষড়ানন' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ষড় + আনন",
        "ষট্ + আনন",
        "ষড্ + আনন",
        "ষট + নন"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ট্ + আ = ড়/ড (ট-বর্গের ৩য় ধ্বনি ড/ড়)। ষট্ (ছয়) + আনন (মুখ) = ষড়ানন (কার্তিকেয়)।",
      "sourcePage": 70,
      "sourceBlockId": "sandhi-p070-mcq-036",
      "family": "36 🟡 INTERMEDIATE • বর্গী য় ১ম→৩য়",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-037",
      "number": 37,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'বাঙ্ময়' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "বাং + ময়",
        "বাক্ + ময়",
        "বাঙ্ + ময়",
        "বাগ্ + ময়"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ক্ + ম = ঙ্ (ক-বর্গের ১ম ধ্বনি নাসিক্য বর্ণ ম-এর প্রভাবে ৫ম ধ্বনি ঙ্ হয়েছে)। বাক্ + ময় = বাঙ্ময়।",
      "sourcePage": 70,
      "sourceBlockId": "sandhi-p070-mcq-037",
      "family": "37 🔴 ADMISSION • বর্গী য় ১ম→৫ম",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-038",
      "number": 38,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মৃন্ময়' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মৃৎ + ময়",
        "মৃন + ময়",
        "মৃণ + ময়",
        "মৃত + ময়"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "ত্ + ম = ন্ (ত-বর্গের ৫ম ধ্বনি দন্ত্য ন)। মৃৎ (মাটি) + ময় = মৃন্ময় (মাটির তৈরি)।",
      "sourcePage": 70,
      "sourceBlockId": "sandhi-p070-mcq-038",
      "family": "38 🔴 ADMISSION • বর্গী য় ১ম→৫ম",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-039",
      "number": 39,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'উচ্চারণ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "উচ + চারণ",
        "উৎ + চারণ",
        "উদ + চারণ",
        "উচ্চ + রণ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ত্ + চ = চ্চ। উৎ + চারণ = উচ্চারণ।",
      "sourcePage": 71,
      "sourceBlockId": "sandhi-p071-mcq-039",
      "family": "39 🟢 BASIC • ত্/দ্ রূপান্তর",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-040",
      "number": 40,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সজ্জন' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সজ + জন",
        "সৎ + জন",
        "সদ + জন",
        "স + জন"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ত্ + জ = জ্জ। সৎ + জন = সজ্জন।",
      "sourcePage": 71,
      "sourceBlockId": "sandhi-p071-mcq-040",
      "family": "40 🟡 INTERMEDIATE • ত্/দ্ রূপান্তর",
      "lessonId": "sandhi-lesson-05"
    },
    {
      "id": "sandhi-source-mcq-041",
      "number": 41,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'উচ্ছ্বাস' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "উৎ + ছ্বাস",
        "উৎ + শ্বাস",
        "উচ + শ্বাস",
        "উদ + ছ্বাস"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ত্ + শ্ = চ্ছ। পরপদে 'শ্বাস' থাকায় ব-ফলা বহাল থেকে হয়েছে 'উচ্ছ্বাস'।",
      "sourcePage": 71,
      "sourceBlockId": "sandhi-p071-mcq-041",
      "family": "41 🔴 ADMISSION • ত্+শ্=চ্ছ",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-042",
      "number": 42,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পদ্ধতি' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পদ্ + হতি",
        "পদ + ধতি",
        "পৎ + হতি",
        "পদ্ + ধতি"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "দ্ + হ = দ্ধ। পদ্ + হতি = পদ্ধতি। অনুরূপভাবে: তৎ + হিত = তদ্ধিত।",
      "sourcePage": 72,
      "sourceBlockId": "sandhi-p072-mcq-042",
      "family": "42 🟣 TRAP • ত্+হ্=দ্ধ",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-043",
      "number": 43,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'উদ্ধার' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "উদ + ধার",
        "উৎ + হার",
        "উৎ + ধার",
        "উধ + হার"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ত্ + হ = দ্ধ। উৎ + হার = উদ্ধার।",
      "sourcePage": 72,
      "sourceBlockId": "sandhi-p072-mcq-043",
      "family": "43 🔴 ADMISSION • ত্+হ্=দ্ধ",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-044",
      "number": 44,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সংবাদ' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সং + বাদ",
        "সম্ + বাদ",
        "সম + বাদ",
        "স + বাদ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অন্তঃস্থ 'ব'-এর পূর্বে ম্ থাকলে ম্ স্থানে বাধ্যতামূলক অনুস্বার (ং) হয়। সম্ + বাদ = সংবাদ।",
      "sourcePage": 72,
      "sourceBlockId": "sandhi-p072-mcq-044",
      "family": "44 🟡 INTERMEDIATE • ম্ সংক্রান্ত",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-045",
      "number": 45,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সংসার' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সং + সার",
        "সম্ + সার",
        "সঙ্ + সার",
        "সম + সার"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "উষ্ম 'স'-এর পূর্বে ম্ অনুস্বার (ং) হয়। সম্ + সার = সংসার।",
      "sourcePage": 73,
      "sourceBlockId": "sandhi-p073-mcq-045",
      "family": "45 🟡 INTERMEDIATE • ম্ সংক্রান্ত",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-046",
      "number": 46,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সঞ্চয়' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সং + চয়",
        "সম্ + চয়",
        "সঞ্ + চয়",
        "সম + চয়"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "চ-বর্গের স্পর্শবর্ণ থাকায় ম্ চ-বর্গের ৫ম বর্ণ 'ঞ'-এ পরিণত হয়ে 'ঞ্চ' হয়েছে। সম্ + চয় = সঞ্চয়।",
      "sourcePage": 73,
      "sourceBlockId": "sandhi-p073-mcq-046",
      "family": "46 🟡 INTERMEDIATE • ম্ সংক্রান্ত",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-047",
      "number": 47,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সংস্কার' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সং + কার",
        "সম্ + কার",
        "সংস + কার",
        "সম্ + স্কার"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "সম্ উপসর্গের পর কৃ -ধাতু জাত কার, কৃ তি, করণ এলে দন্ত্য 'স্'-এর অনুপ্রবেশ ঘটে। সম্ + কার = সংস্কার।",
      "sourcePage": 73,
      "sourceBlockId": "sandhi-p073-mcq-047",
      "family": "47 🟣 TRAP • স্ আগম",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-048",
      "number": 48,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'সংস্কৃ তি' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "সং + কৃ তি",
        "সম্ + কৃ তি",
        "সংস + কৃ তি",
        "সম + কৃ তি"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "সম্ + কৃ তি = সংস্কৃ তি। স্-এর আগমন ঘটেছে।",
      "sourcePage": 74,
      "sourceBlockId": "sandhi-p074-mcq-048",
      "family": "48 🔴 ADMISSION • স্ আগম",
      "lessonId": "sandhi-lesson-06"
    },
    {
      "id": "sandhi-source-mcq-049",
      "number": 49,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'অভিষেক' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "অভি + ষেক",
        "অভি + সেক",
        "অভী + সেক",
        "অভিস + এক"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ই-কারান্ত উপসর্গের পর দন্ত্য 'স' মূর্ধন্য 'ষ'-এ পরিণত হয়। তাই মূল পদে 'সেক' (দন্ত্য স) ছিল। অভি + সেক = অভিষেক।",
      "sourcePage": 74,
      "sourceBlockId": "sandhi-p074-mcq-049",
      "family": "49 🟡 INTERMEDIATE • ষত্ব বিধান",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-050",
      "number": 50,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ইষ্ট' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ইষ্ + ত",
        "ইষ + ট",
        "ইত + ত",
        "ইশ + ত"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "ষ্ + ত = ষ্ট। তাই ইষ্ + ত = ইষ্ট। অনুরূপভাবে: কৃ ষ্ + ত = কৃ ষ্ট।",
      "sourcePage": 74,
      "sourceBlockId": "sandhi-p074-mcq-050",
      "family": "50 🔴 ADMISSION • ষ্ রূপান্তর",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-051",
      "number": 51,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'ষষ্ঠ' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "ষষ + ঠ",
        "ষষ্ + থ",
        "ষট + থ",
        "ষস্ + থ"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ষ্ + থ = ষ্ঠ। ষষ্ + থ = ষষ্ঠ।",
      "sourcePage": 75,
      "sourceBlockId": "sandhi-p075-mcq-051",
      "family": "51 🔴 ADMISSION • ষ্ রূপান্তর",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-052",
      "number": 52,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নীরব' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নি + রব",
        "নিঃ + রব",
        "নীর + ব",
        "নীঃ + রব"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "বিসর্গের পর 'র' থাকলে বিসর্গ বিলুপ্ত হয় এবং পূর্বের হ্রস্ব ই দীর্ঘ ঈ-তে পরিণত হয়। তাই নিঃ (হ্রস্ব) + রব = নীরব (দীর্ঘ)।",
      "sourcePage": 75,
      "sourceBlockId": "sandhi-p075-mcq-052",
      "family": "52 🟣 TRAP • বিসর্গ দীর্ঘী ভবন",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-053",
      "number": 53,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'নীরোগ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "নিঃ + রোগ",
        "নির + রোগ",
        "নীঃ + রোগ",
        "নি + রোগ"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "নিঃ + রোগ = নীরোগ। এটি বানান শুদ্ধিতেও সবচেয়ে বেশি আসে। নিরোগ সম্পূর্ণ অশুদ্ধ।",
      "sourcePage": 75,
      "sourceBlockId": "sandhi-p075-mcq-053",
      "family": "53 🟣 TRAP • বিসর্গ দীর্ঘী ভবন",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-054",
      "number": 54,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'মনোভাব' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "মনো + ভাব",
        "মনঃ + ভাব",
        "মনস্ + ভাব",
        "মন + ভাব"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ-কারান্ত শব্দের পর স-জাত বিসর্গ ও ঘোষ বর্ণ (ভ) থাকলে বিসর্গ ও পূর্বস্বর মিলে ও- কার হয়। মনঃ + ভাব = মনোভাব।",
      "sourcePage": 76,
      "sourceBlockId": "sandhi-p076-mcq-054",
      "family": "54 🟢 BASIC • স-জাত বিসর্গ",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-055",
      "number": 55,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পুনর্জ ন্ম' শব্দের সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পুনর + জন্ম",
        "পুনঃ + জন্ম",
        "পুন + জন্ম",
        "পুনো + জন্ম"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "এটি র-জাত বিসর্গ সন্ধি। পুনঃ + জন্ম = পুনর্জ ন্ম (বিসর্গ রেফ হয়েছে)।",
      "sourcePage": 76,
      "sourceBlockId": "sandhi-p076-mcq-055",
      "family": "55 🟡 INTERMEDIATE • র-জাত বিসর্গ",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-056",
      "number": 56,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'আবিষ্কার' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "আবিস + কার",
        "আবিঃ + কার",
        "আবিষ্ + কার",
        "আবি + কার"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "ই-কারের পর বিসর্গ ও 'ক' থাকলে বিসর্গ মূর্ধন্য 'ষ্' হয়। আবিঃ + কার = আবিষ্কার।",
      "sourcePage": 76,
      "sourceBlockId": "sandhi-p076-mcq-056",
      "family": "56 🔴 ADMISSION • বিসর্গ ও ষত্ব",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-057",
      "number": 57,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পুরস্কার' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পুরস্ + কার",
        "পুরঃ + কার",
        "পুরা + কার",
        "পুরো + কার"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "অ-কারের পর বিসর্গ ও 'ক' থাকলে বিসর্গ দন্ত্য 'স্' হয়। পুরঃ + কার = পুরস্কার।",
      "sourcePage": 77,
      "sourceBlockId": "sandhi-p077-mcq-057",
      "family": "57 🔴 ADMISSION • বিসর্গ ও স",
      "lessonId": "sandhi-lesson-07"
    },
    {
      "id": "sandhi-source-mcq-058",
      "number": 58,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'কু লটা' কোন সন্ধির উদাহরণ?",
      "options": [
        "নিপাতনে সিদ্ধ স্বরসন্ধি",
        "নিপাতনে সিদ্ধ ব্যঞ্জনসন্ধি",
        "খাঁটি বাংলা স্বরসন্ধি",
        "বিশেষ নিয়মে সাধিত সন্ধি"
      ],
      "answer": 0,
      "correctLetter": "A",
      "explanation": "কু ল + অটা = কু লটা (নিয়ম অনুযায়ী কু লাটা হওয়ার কথা কিন্তু হয়নি)। এটি নিপাতনে সিদ্ধ স্বরসন্ধি।",
      "sourcePage": 77,
      "sourceBlockId": "sandhi-p077-mcq-058",
      "family": "58 🟣 TRAP • নিপাতনে স্বর",
      "lessonId": "sandhi-lesson-08"
    },
    {
      "id": "sandhi-source-mcq-059",
      "number": 59,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'গবাক্ষ' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "গব + অক্ষ",
        "গো + অক্ষ",
        "গবা + অক্ষ",
        "গো + অক্ষি"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "গো + অক্ষ = গবাক্ষ (বাতায়ন বা জানালা)। এটি একটি বিখ্যাত নিপাতনে সিদ্ধ স্বরসন্ধি।",
      "sourcePage": 77,
      "sourceBlockId": "sandhi-p077-mcq-059",
      "family": "59 🔴 ADMISSION • নিপাতনে স্বর",
      "lessonId": "sandhi-lesson-08"
    },
    {
      "id": "sandhi-source-mcq-060",
      "number": 60,
      "type": "mcq",
      "contentOrigin": "source",
      "question": "'পতঞ্জলি' শব্দের সঠিক সন্ধি বিচ্ছেদ কোনটি?",
      "options": [
        "পতন + অঞ্জলি",
        "পতৎ + অঞ্জলি",
        "পত + অঞ্জলি",
        "পতদ + অঞ্জলি"
      ],
      "answer": 1,
      "correctLetter": "B",
      "explanation": "পতৎ + অঞ্জলি = পতঞ্জলি। এটি ব্যাকরণের নিপাতনে সিদ্ধ ব্যঞ্জনসন্ধির অন্যতম শ্রেষ্ঠ উদাহরণ।",
      "sourcePage": 78,
      "sourceBlockId": "sandhi-p078-mcq-060",
      "family": "60 🔴 ADMISSION • নিপাতনে ব্যঞ্জন",
      "lessonId": "sandhi-lesson-08"
    }
  ],
  "integrity": {
    "sourceLocked": true,
    "generatedText": false,
    "crossCourseMerge": false,
    "coverage": "84/84 source pages mapped",
    "sourceQuestionCount": 60
  }
};
  window.__admissionInteractiveCoursePacks = Array.isArray(window.__admissionInteractiveCoursePacks) ? window.__admissionInteractiveCoursePacks : [];
  window.__admissionInteractiveCoursePacks = window.__admissionInteractiveCoursePacks.filter(c => c.id !== course.id).concat(course);
})();
