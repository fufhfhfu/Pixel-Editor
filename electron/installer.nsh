!macro customInstall
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pxproj\shell\open_with_pixel_editor" "" "Открыть в Pixel Editor"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pxproj\shell\open_with_pixel_editor\command" "" '"$INSTDIR\Pixel Editor.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pxproj\shell\open_with_pixel_editor"
!macroend
