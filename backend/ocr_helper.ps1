param (
    [string]$ImagePath
)

$ErrorActionPreference = "Stop"

try {
    # Ensure full absolute path
    $resolvedPath = [System.IO.Path]::GetFullPath($ImagePath)

    # Load WinRT assemblies
    [void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    [void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime]
    [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    [void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
    [void][Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]

    # Load System.Runtime.WindowsRuntime
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    # Get file asynchronously and wait using AsTask
    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath)
    $fileTask = [System.WindowsRuntimeSystemExtensions]::AsTask($fileOp)
    $fileTask.Wait()
    $file = $fileTask.Result

    # Open stream
    $streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
    $streamTask = [System.WindowsRuntimeSystemExtensions]::AsTask($streamOp)
    $streamTask.Wait()
    $stream = $streamTask.Result

    # Decode image
    $decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
    $decoderTask = [System.WindowsRuntimeSystemExtensions]::AsTask($decoderOp)
    $decoderTask.Wait()
    $decoder = $decoderTask.Result

    $bitmapOp = $decoder.GetSoftwareBitmapAsync()
    $bitmapTask = [System.WindowsRuntimeSystemExtensions]::AsTask($bitmapOp)
    $bitmapTask.Wait()
    $bitmap = $bitmapTask.Result

    # Try creating OCR engine with user languages
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
        $lang = [Windows.Globalization.Language]::new("en-US")
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    }

    if ($null -eq $engine) {
        Write-Error "Could not create Windows OCR Engine."
        exit 1
    }

    # Recognize text
    $ocrOp = $engine.RecognizeAsync($bitmap)
    $ocrTask = [System.WindowsRuntimeSystemExtensions]::AsTask($ocrOp)
    $ocrTask.Wait()
    $ocrResult = $ocrTask.Result

    # Output each line
    $ocrResult.Lines | ForEach-Object { $_.Text }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
