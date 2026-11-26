// Code-signing trust check for the macOS legacy login keychain (src/keychain.rs).
//
// Legacy login.keychain-db items bind their ACL to the creating binary's designated requirement.
// Ad-hoc signed builds (`codesign -s -`) have no certificate chain or team identifier, so macOS
// pins the ACL to the binary's exact CDHash: every install, update or rebuild gets a new CDHash
// and pops up a blocking login-keychain password modal for every entry. Only builds signed with a
// real certificate (non-ad-hoc, with a team identifier) have a stable identity across updates.

#import <Foundation/Foundation.h>
#import <Security/Security.h>

/// Returns 1 when this process has a stable non-ad-hoc code signature with a team identifier.
int polar_macos_has_stable_signature(void) {
    @autoreleasepool {
        SecCodeRef selfCode = NULL;
        if (SecCodeCopySelf(kSecCSDefaultFlags, &selfCode) != errSecSuccess || !selfCode) {
            return 0;
        }
        CFDictionaryRef info = NULL;
        OSStatus status = SecCodeCopySigningInformation(selfCode, kSecCSSigningInformation, &info);
        CFRelease(selfCode);
        if (status != errSecSuccess || !info) {
            return 0;
        }
        NSDictionary *dict = (__bridge_transfer NSDictionary *)info;
        NSNumber *flags = dict[(__bridge NSString *)kSecCodeInfoFlags];
        if ((flags.unsignedIntValue & kSecCodeSignatureAdhoc) != 0) {
            return 0;
        }
        NSString *team = dict[(__bridge NSString *)kSecCodeInfoTeamIdentifier];
        return (team.length > 0) ? 1 : 0;
    }
}
