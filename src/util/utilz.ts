import * as path from 'path'
import * as fs from 'fs'
import { normalizePath } from './misc';
import { hasInternalPlayerSkeleton, INTERNAL_PLAYER_BONE_NAME_SET } from '../constants/internalPlayer'

export function isInternalModel(settings) {
    // @ts-ignore
    //return settings.iaentitymodel.namespace === "iainternal" // TODO: make this better...
    return isPlayerModel(settings) // TODO: make this better...
}

export function isInternalPlayerModel(settings) {
    // @ts-ignore
    //return settings.iaentitymodel.namespace === "iainternal" && settings.iaentitymodel.projectName === "player" // TODO: make this better...
    return isPlayerModel(settings) // TODO: make this better...
}

export function isPlayerModel(settings) {
    // @ts-ignore
    //return settings.iaentitymodel.namespace === "iainternal" && settings.iaentitymodel.projectName === "player" // TODO: make this better...
    return hasInternalPlayerSkeleton(Group.all)
}

export function needsToExportJsonsModels(settings) {
    // @ts-ignore
    return !isInternalModel(settings) || settings.iaentitymodel.addsAdditionalModels;
}

export function isInternalElement(name) {
    return INTERNAL_PLAYER_BONE_NAME_SET.has(name);
}

export function getCorrectInternalElementName(name) {
    return "_iainternal:entity/player/" + name;
}

export function getProjectFolder() {
    let fileName = Project.save_path.replace(/\\/g, '/').split('/').pop()
    let dirPath = Project.save_path.slice(0, -fileName.length - 1)

    return path.normalize(dirPath)
}

export function getProjectRootFolder() {
    let fileName = Project.save_path.replace(/\\/g, '/').split('/').pop()
    let dirPath = Project.save_path.slice(0, -fileName.length - 1)

    return path.normalize(dirPath)
}

function getResourceRootFolder(projectRoot: string, namespace: string, requireExplicitNamespace = false) {
    const resourcepack = path.join(projectRoot, 'resourcepack')
    if (fs.existsSync(path.join(resourcepack, 'assets'))) return path.join(resourcepack, 'assets', namespace)
    if (fs.existsSync(path.join(resourcepack, namespace))) return path.join(resourcepack, namespace)
    if (fs.existsSync(path.join(projectRoot, 'assets'))) return path.join(projectRoot, 'assets', namespace)
    if (fs.existsSync(path.join(projectRoot, namespace))) return path.join(projectRoot, namespace)
    if (fs.existsSync(resourcepack) || requireExplicitNamespace) return path.join(resourcepack, 'assets', namespace)
    return projectRoot
}

export function getModelExportFolder(settings) {
    const projectRoot = getProjectRootFolder()
    const resourceRoot = getResourceRootFolder(projectRoot, settings.iaentitymodel.namespace, settings.iaentitymodel.entityFormat === 'v2')
    const folderParts = [resourceRoot, "models", "entity", settings.iaentitymodel.projectName]

    const modelsPath = normalizePath(path.join(...folderParts))

    // Dirty way
    //if(!isInternalModel(settings)) {
        fs.mkdirSync(modelsPath, {recursive: true})
    //}

    return modelsPath
}

export function getAdvancedPlayerModelExportFolder(settings) {
    const projectRoot = getProjectRootFolder()
    const resourceRoot = getResourceRootFolder(projectRoot, settings.iaentitymodel.namespace, true)
    const folderParts = [resourceRoot, "models", "entity", settings.iaentitymodel.projectName]

    const modelsPath = normalizePath(path.join(...folderParts))
    fs.mkdirSync(modelsPath, {recursive: true})
    return modelsPath
}

export function getTexturesExportFolder(settings) {
    const projectRoot = getProjectRootFolder()
    const resourceRoot = getResourceRootFolder(projectRoot, settings.iaentitymodel.namespace)
    const folderParts = [resourceRoot, "textures", "entity", settings.iaentitymodel.projectName]

    const texturesPath = normalizePath(path.join(...folderParts))

    // Dirty way
    //if(!isInternalModel(settings)) {
        fs.mkdirSync(texturesPath, {recursive: true})
    //}

    return texturesPath
}

export function fixMinecraftTexturesReferences() {
    Texture.all.forEach((t : Texture) => {
        // Make sure if a texture is a Minecraft texture it does get marked as it, to avoid exporting it later.
        // @ts-ignore
        let tmpPath = t.path.replaceAll("\\", "/");
        let texturesPartialPath = "/assets/minecraft/textures/";
        if(tmpPath.includes(texturesPartialPath)) {
            // @ts-ignore
            t.namespace = "minecraft";
            // @ts-ignore
            t.folder = tmpPath.split(texturesPartialPath)[1].split("/")[0];
        } else {
            // @ts-ignore
            if(t.namespace === "minecraft") {
                // @ts-ignore
                t.namespace = "";
                // @ts-ignore
                t.folder = "";
            }
        }
    })
}

export function getProjectSaveFolder() {
    let fileName = Project.save_path.replace(/\\/g, '/').split('/').pop()
    let dirPath = Project.save_path.slice(0, -fileName.length)

	return dirPath = normalizePath(dirPath);
}

export function refreshGroupsProperties() {
    // If any project is opened
    if(Project) {
        for (const [groupName, group] of Object.entries(Project.groups)) {

            if(group["boneType"] === "head")
                group["icon"] = "fa fa-smile"
            else if(group["boneType"] === "leftHandPivot")
                group["icon"] = "fa fa-hand-point-left"
            else if(group["boneType"] === "hatPivot")
                group["icon"] = "fa fa-hat-wizard"
            else if(group["boneType"] === "rightHandPivot")
                group["icon"] = "fa fa-hand-point-right"
            else if(group["boneType"] === "mount")
                group["icon"] = "fa fa-chair"
            else if(group["boneType"] === "locator")
                group["icon"] = "fa fa-anchor"
            else if(group["boneType"] === "hitbox")
                group["icon"] = "fa fa-square-full"
            else if(group.parent["name"] === undefined) // Root element
                group["icon"] = "fa fa-archive"
            else
                group["icon"] = "fa fa-bone"

            // Rename to lowercase each group name.
            // Transform from "GroupName" to "group_name" (snake case)
            let newName = group["name"].replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
            if(newName !== group["name"]) {
                group["name"] = newName;
            }

            group.updateElement()
        }
    }

    //if(Project.groups.length > 0)
    //    Project.groups[0]["icon"] = "fa fa-archive" // Root element
}

export function toJson(object: any) : string {
    // @ts-ignore
    return compileJSON(object, {small: true})
}
