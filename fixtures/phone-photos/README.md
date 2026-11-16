# Phone photos for the OCR spike (formbridge-any-document task 3.4)

Photograph only the printed synthetic sample forms below. Never photograph a real form, a filled-in form with real details, an ID card or anything with a person's details on it.

Before you start, turn off location in the camera app so the photos carry no GPS position. Kiro checks every file for location data before committing it.

## What to print

Print these two files on plain A4 paper, at actual size:

- `fixtures/documents/clean-en.png` (English sample form)
- `fixtures/documents/clean-ms.png` (Malay sample form)

## What to photograph: 8 photos

| File name | Form | How |
|---|---|---|
| `en-good.jpg` | English | Daylight or a bright room, phone held straight above the page, the whole page in the picture |
| `ms-good.jpg` | Malay | Same as above |
| `en-angle.jpg` | English | Same light, phone tilted at about 30 degrees, the whole page in the picture |
| `en-sideways.jpg` | English | Phone held sideways (landscape), page upright on the table |
| `en-dim.jpg` | English | Dim room, no flash |
| `en-glare.jpg` | English | A lamp or window reflecting on the page |
| `en-blurry.jpg` | English | Move the phone a little while you press the shutter |
| `en-far.jpg` | English | From about 1 metre away, so the page fills about a quarter of the picture |

Take them with the normal camera app, at its normal settings, on the mid-range Android phone. If you also have an iPhone, take `en-good.jpg` and `ms-good.jpg` again with it and add `-iphone` to the names.

## Where to put them

Copy the files into this folder, `fixtures/phone-photos/`, with the names above. Then tell Kiro which phone (model and browser version) took them.

## What Kiro then measures on the phone

Some checks need the phone itself, with the app open in its browser: reading time per page, cancel during reading, the second visit loading from cache, and the first visit on a slow connection. Kiro gives the exact steps for these after the photos are in.
