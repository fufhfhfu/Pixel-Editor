!macro customInstall
  WriteRegStr HKCR "SystemFileAssociations\.pxproj\shell\PixelEditor" "MUIVerb" "Открыть в Pixel Editor"
  WriteRegStr HKCR "SystemFileAssociations\.pxproj\shell\PixelEditor" "Icon" "$INSTDIR\Pixel Editor.exe"
  WriteRegStr HKCR "SystemFileAssociations\.pxproj\shell\PixelEditor\command" "" '"$INSTDIR\Pixel Editor.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCR "SystemFileAssociations\.pxproj\shell\PixelEditor"
!macroend
